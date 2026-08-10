/**
 * Browser-side WebRTC client for the OpenAI Realtime API.
 *
 * Connection flow (see docs/research/realtime-api-reference.md, verified
 * 2026-08-09 against developers.openai.com/api/docs/*):
 *   1. GET /api/session on our own server -> { value, expires_at } ephemeral
 *      client secret (the real API key never reaches the browser).
 *   2. Build an RTCPeerConnection, attach the mic track
 *      (getUserMedia({ audio: true })), and create a data channel named
 *      'oai-events' for JSON client/server events.
 *   3. POST the SDP offer to https://api.openai.com/v1/realtime/calls with
 *      Authorization: Bearer <ephemeral value> and
 *      Content-Type: application/sdp. No ?model= query param -- the model
 *      is baked into the ephemeral secret at mint time (the query-param
 *      form is the deprecated pre-GA beta flow).
 *   4. setRemoteDescription() with the returned SDP answer.
 *
 * This module is framework-free browser code -- it must not import
 * Node-only modules (fs, path, etc.) so it can ship to the client bundle.
 */

/** Actions produced by handleServerEvent, consumed by the UI/orchestration layer (Task 8). */
export type Action =
  | { kind: 'tool_call'; callId: string; name: string; args: unknown }
  | { kind: 'user_transcript'; text: string }
  | { kind: 'bot_transcript'; text: string };

/** Raw parsed data-channel message from the Realtime API. Shape varies by event type. */
export type ServerEvent = { type: string; [key: string]: unknown };

interface RealtimeItemFunctionCall {
  type: 'function_call';
  name: string;
  call_id: string;
  arguments: string;
  [key: string]: unknown;
}

function isFunctionCallItem(item: unknown): item is RealtimeItemFunctionCall {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as { type?: unknown }).type === 'function_call' &&
    typeof (item as { name?: unknown }).name === 'string' &&
    typeof (item as { call_id?: unknown }).call_id === 'string' &&
    typeof (item as { arguments?: unknown }).arguments === 'string'
  );
}

/**
 * Pure function mapping a raw server event to a UI action. Exported
 * separately from RealtimeClient so it is testable without any WebRTC
 * machinery (jsdom, RTCPeerConnection, etc.).
 *
 * - response.done: for every function_call item in response.output, emit a
 *   tool_call action. Zero items -> null. One or more items -> Action[]
 *   (see report for why this deviates from the brief's `Action | null`
 *   signature: a single response.done can legitimately contain multiple
 *   parallel tool calls, and collapsing that into "one at a time" would
 *   either drop calls or require handleServerEvent to fabricate multiple
 *   invocations from one event).
 * - conversation.item.input_audio_transcription.completed -> user_transcript
 * - response.output_audio_transcript.done -> bot_transcript
 * - anything else -> null
 */
export function handleServerEvent(event: ServerEvent): Action | Action[] | null {
  switch (event.type) {
    case 'response.done': {
      const response = event.response as { output?: unknown } | undefined;
      const output = Array.isArray(response?.output) ? response!.output : [];
      const calls: Action[] = output.filter(isFunctionCallItem).map((item) => ({
        kind: 'tool_call' as const,
        callId: item.call_id,
        name: item.name,
        args: JSON.parse(item.arguments) as unknown,
      }));
      return calls.length > 0 ? calls : null;
    }

    case 'conversation.item.input_audio_transcription.completed': {
      const text = event.transcript;
      return typeof text === 'string' ? { kind: 'user_transcript', text } : null;
    }

    case 'response.output_audio_transcript.done': {
      const text = event.transcript;
      return typeof text === 'string' ? { kind: 'bot_transcript', text } : null;
    }

    default:
      return null;
  }
}

interface SessionTokenResponse {
  value: string;
  expires_at: number;
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DATA_CHANNEL_NAME = 'oai-events';

/**
 * Message sent (as a conversation.item.create, role user, input_text) immediately after a
 * reconnect's data channel reopens, before the single response.create that follows it. Asks the
 * model to re-orient itself using the tool it already has (get_student_profile) rather than
 * inventing recap content from nothing -- the client has no memory of the pre-drop conversation
 * beyond the transcript strip, which is UI-only and not replayed into the model's context.
 */
export const RESUME_MESSAGE =
  'SYSTEM: session resumed after connection drop — call get_student_profile, recap where we were in one sentence, continue';

/** connectionstate values that indicate the connection dropped, plus the data channel's own close event. */
export type ConnectionDropState = RTCPeerConnectionState | 'datachannel-closed';

/** Max automatic reconnect attempts before giving up and surfacing manual Connect. */
export const MAX_RECONNECT_ATTEMPTS = 3;

/** Backoff schedule (ms) for reconnect attempts 1, 2, 3. */
export const RECONNECT_BACKOFF_MS = [1000, 5000, 15000] as const;

/**
 * Pure decision function: should the client attempt an automatic reconnect right now?
 *
 * - Never reconnects if the user clicked Disconnect (userInitiated) -- WS-B item 1 is
 *   explicitly SKIPPED: no auto-connect/reconnect against user intent, manual Connect always
 *   wins.
 * - Never reconnects once `attempt` (attempts already made) has reached MAX_RECONNECT_ATTEMPTS.
 * - Reconnects only on the drop states that actually indicate a dead connection: pc
 *   connectionstate 'disconnected' | 'failed' | 'closed', or a data channel close (how the
 *   60-minute server session cap manifests). Benign states ('connected', 'connecting', 'new')
 *   never trigger a reconnect.
 */
export function shouldReconnect(state: ConnectionDropState, userInitiated: boolean, attempt: number): boolean {
  if (userInitiated) return false;
  if (attempt >= MAX_RECONNECT_ATTEMPTS) return false;
  return state === 'disconnected' || state === 'failed' || state === 'closed' || state === 'datachannel-closed';
}

/**
 * Backoff delay (ms) before making the Nth reconnect attempt (1-based: attempt 1 is the first
 * retry after the initial drop). Throws for out-of-range attempt numbers rather than returning
 * a fallback -- callers should have already stopped via shouldReconnect before reaching this.
 */
export function getReconnectDelay(attempt: number): number {
  const idx = attempt - 1;
  const delay = RECONNECT_BACKOFF_MS[idx];
  if (delay === undefined) {
    throw new Error(`getReconnectDelay: attempt out of range (${attempt}); expected 1-${RECONNECT_BACKOFF_MS.length}`);
  }
  return delay;
}

/**
 * Manages the WebRTC connection to the OpenAI Realtime API: mints a session
 * token from our own /api/session route, negotiates the peer connection,
 * and exposes a simple event/send interface over the 'oai-events' data
 * channel. WebRTC plumbing itself is exercised live in Task 9 (no jsdom
 * theater here) -- this class is intentionally thin around handleServerEvent.
 */
export class RealtimeClient {
  private readonly audioElement: HTMLAudioElement;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private readonly handlers = new Set<(event: ServerEvent) => void>();
  private readonly connectionStateHandlers = new Set<(state: RTCPeerConnectionState) => void>();
  private readonly dataChannelCloseHandlers = new Set<() => void>();

  constructor(audioElement: HTMLAudioElement) {
    this.audioElement = audioElement;
  }

  onEvent(handler: (event: ServerEvent) => void): void {
    this.handlers.add(handler);
  }

  /** Surfaces RTCPeerConnection state changes (e.g. 'connected', 'disconnected', 'failed', 'closed'). */
  onConnectionStateChange(handler: (state: RTCPeerConnectionState) => void): void {
    this.connectionStateHandlers.add(handler);
  }

  /**
   * Surfaces the data channel's own 'close' event -- distinct from RTCPeerConnection
   * connectionstate because the 60-minute server session cap closes the data channel without
   * necessarily flipping the peer connection state first (see ConnectionDropState/shouldReconnect).
   */
  onDataChannelClose(handler: () => void): void {
    this.dataChannelCloseHandlers.add(handler);
  }

  sendEvent(event: object): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('RealtimeClient: data channel is not open');
    }
    this.dataChannel.send(JSON.stringify(event));
  }

  /**
   * Sends one function_call_output item for a tool call, WITHOUT triggering a response.
   * See docs/research/realtime-api-reference.md §5 for the two-event tool-result flow: when a
   * response.done contains multiple parallel tool calls, every call must get its
   * function_call_output queued before a single response.create is sent for the whole batch --
   * sending response.create per-call races the model into replying before later calls in the
   * same batch have their outputs queued, which can wedge the session waiting on a call that
   * never gets acknowledged. Callers (app/page.tsx) send one output per call via this method,
   * then call requestResponse() exactly once after the whole batch is queued.
   */
  sendToolOutput(callId: string, output: unknown): void {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
  }

  /** Sends one user image message, then asks the model to respond to it. */
  sendImage(dataUrl: string, note?: string): void {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_image', image_url: dataUrl },
          ...(note ? [{ type: 'input_text', text: note }] : []),
        ],
      },
    });
    this.requestResponse();
  }

  /** Requests a model response. Call exactly once after a batch of sendToolOutput calls. */
  requestResponse(): void {
    this.sendEvent({ type: 'response.create' });
  }

  /**
   * Negotiates a fresh WebRTC connection.
   *
   * Pass `{ resume: true }` after an automatic reconnect (see shouldReconnect/getReconnectDelay):
   * once the new data channel opens, this sends the RESUME_MESSAGE as a conversation.item.create
   * (role user, input_text) so the model re-orients via get_student_profile and recaps, THEN
   * calls requestResponse() exactly once. On a normal (non-resume) connect, requestResponse() is
   * still called exactly once, with no preceding message. Either way there is exactly one
   * requestResponse() call per connect() -- resume never double-fires response.create, it just
   * queues one extra conversation.item.create ahead of the same single response.create.
   */
  async connect(opts: { resume?: boolean } = {}): Promise<void> {
    try {
      const tokenResponse = await fetch('/api/session');
      if (!tokenResponse.ok) {
        throw new Error(`RealtimeClient: failed to fetch session token (${tokenResponse.status})`);
      }
      const { value: ephemeralKey } = (await tokenResponse.json()) as SessionTokenResponse;

      const pc = new RTCPeerConnection();
      this.peerConnection = pc;

      pc.ontrack = (e) => {
        this.audioElement.srcObject = e.streams[0];
      };

      pc.onconnectionstatechange = () => {
        for (const handler of this.connectionStateHandlers) {
          handler(pc.connectionState);
        }
      };

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of this.micStream.getTracks()) {
        pc.addTrack(track, this.micStream);
      }

      const dc = pc.createDataChannel(DATA_CHANNEL_NAME);
      this.dataChannel = dc;
      dc.addEventListener('message', (e: MessageEvent) => {
        const event = JSON.parse(e.data) as ServerEvent;
        for (const handler of this.handlers) {
          handler(event);
        }
      });
      dc.addEventListener('close', () => {
        for (const handler of this.dataChannelCloseHandlers) {
          handler();
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpResponse.ok) {
        throw new Error(`RealtimeClient: SDP exchange failed (${sdpResponse.status})`);
      }
      const answer: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

      // Wait for the data channel to actually open before resolving -- sendEvent/sendToolOutput
      // require an open channel, and the caller (app/page.tsx) sends the first response.create
      // immediately after connect() resolves so the bot fetches the profile and greets.
      await new Promise<void>((resolve, reject) => {
        if (dc.readyState === 'open') {
          resolve();
          return;
        }
        dc.addEventListener('open', () => resolve(), { once: true });
        dc.addEventListener(
          'error',
          () => reject(new Error('RealtimeClient: data channel failed to open')),
          { once: true }
        );
      });

      if (opts.resume) {
        this.sendEvent({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: RESUME_MESSAGE }],
          },
        });
      }
      this.requestResponse();
    } catch (err) {
      // Failed connect: stop the mic and tear down anything partially set up so a retry
      // doesn't leak a live microphone track or a half-open peer connection.
      for (const track of this.micStream?.getTracks() ?? []) {
        track.stop();
      }
      this.micStream = null;
      this.dataChannel?.close();
      this.dataChannel = null;
      this.peerConnection?.close();
      this.peerConnection = null;
      throw err;
    }
  }

  disconnect(): void {
    this.dataChannel?.close();
    this.dataChannel = null;

    this.peerConnection?.close();
    this.peerConnection = null;

    for (const track of this.micStream?.getTracks() ?? []) {
      track.stop();
    }
    this.micStream = null;

    this.audioElement.srcObject = null;
  }
}
