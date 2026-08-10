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

  /** Requests a model response. Call exactly once after a batch of sendToolOutput calls. */
  requestResponse(): void {
    this.sendEvent({ type: 'response.create' });
  }

  async connect(): Promise<void> {
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
