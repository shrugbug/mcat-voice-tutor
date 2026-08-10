'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  RealtimeClient,
  handleServerEvent,
  shouldReconnect,
  getReconnectDelay,
  type Action,
  type ServerEvent,
  type ConnectionDropState,
} from '@/lib/realtime-client';
import { fitWithin, isAcceptedImageMime } from '@/lib/imageprep';
import type { Profile } from '@/lib/student';
import { ViewSpecSchema, type ViewSpec } from '@/lib/views';
import ContentPanel, { type DisplayContent } from './components/ContentPanel';
import MasterySidebar, { type Tally } from './components/MasterySidebar';

type TranscriptLine = { speaker: 'user' | 'bot'; text: string };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1536;
const IMAGE_JPEG_QUALITY = 0.85;
const QUESTION_PHOTO_NOTE =
  'Photo of a practice question I want to review. Read it, then quiz me on it.';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the question photo.'));
      }
    });
    reader.addEventListener('error', () => reject(new Error('Could not read the question photo.')));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Could not decode the question photo.')), {
      once: true,
    });
    image.src = dataUrl;
  });
}

async function prepareImageDataUrl(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const dimensions = fitWithin(image.naturalWidth, image.naturalHeight, MAX_IMAGE_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the question photo.');
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
  return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
}

// Polls `isInFlight` every 100ms and resolves once it reports false, up to a 5s cap so a stuck
// batch can never hang the photo path forever. The photo path is user-paced, so a sub-second
// wait here is imperceptible.
function waitForToolBatch(isInFlight: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (!isInFlight() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function callTool(name: string, args: unknown): Promise<{ result?: unknown; error?: string }> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  return (await res.json()) as { result?: unknown; error?: string };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // True from the moment handleActions starts resolving a batch of tool calls until it has sent
  // every function_call_output AND fired the batch's single requestResponse(). sendQuestionPhoto
  // polls this (see waitForToolBatch) before calling client.sendImage, which fires its own
  // requestResponse() -- without the wait, an image sent mid-batch could have its response.create
  // land between sendToolOutput calls and the batch's own requestResponse(), orphaning outputs.
  const toolBatchInFlightRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState<DisplayContent | null>(null);
  const [view, setView] = useState<ViewSpec | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tally, setTally] = useState<Tally>({ asked: 0, correct: 0 });
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [modeBadge, setModeBadge] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Elapsed timer is cumulative across reconnects: cumulativeBaseRef accrues the duration of
  // every prior connected segment, startedAt marks the current segment's start (or null while
  // reconnecting/disconnected). Only a manual Disconnect or a fresh Connect from a fully
  // disconnected state zeroes this out -- an automatic reconnect must not reset it.
  const cumulativeBaseRef = useRef(0);
  // Mirrors `startedAt` for reads outside the React update cycle (pauseElapsedTimer needs the
  // current segment start synchronously, without going through a setState updater -- see below).
  const startedAtRef = useRef<number | null>(null);

  const [reconnecting, setReconnecting] = useState(false);
  // True once the user has clicked Disconnect for the current client lifecycle -- shouldReconnect
  // always returns false while this is set, per WS-B item 1 (no auto-connect/reconnect against
  // user intent; manual Connect always wins).
  const userDisconnectedRef = useRef(false);
  // Number of automatic reconnect attempts made so far for the current drop. Reset to 0 on every
  // successful (re)connect and on manual disconnect.
  const reconnectAttemptRef = useRef(0);
  // Guards against handling the same drop twice: connectionstatechange and the data channel's
  // own 'close' event can both fire for a single drop.
  const dropHandledRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Reads startedAtRef.current (not the setStartedAt functional-updater form) so the accrual
  // into cumulativeBaseRef happens exactly once even under StrictMode's double-invocation of
  // updater functions -- an updater body would double-count elapsed time on every drop.
  const pauseElapsedTimer = useCallback(() => {
    const prev = startedAtRef.current;
    if (prev !== null) cumulativeBaseRef.current += Date.now() - prev;
    setStartedAt(null);
  }, []);

  const refreshSidebar = useCallback(() => {
    void callTool('get_student_profile', {}).then((res) => {
      if (res.result) setProfile(res.result as Profile);
    });
  }, []);

  // Show seeded categories even before connecting.
  useEffect(() => {
    refreshSidebar();
  }, [refreshSidebar]);

  // Elapsed session timer: cumulative across reconnects (cumulativeBaseRef + current segment).
  useEffect(() => {
    startedAtRef.current = startedAt;
    if (!connected || startedAt === null) return;
    const tick = () => setElapsedMs(cumulativeBaseRef.current + (Date.now() - startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [connected, startedAt]);

  // Resolve one tool_call action to its function_call_output payload. Never throws: every
  // failure path (fetch rejection, malformed args, dispatcher {error}) resolves to an
  // {error} payload so the batch below can always send a function_call_output for every
  // call_id -- an un-acknowledged call_id is exactly what wedges the session (CRITICAL 2).
  const resolveToolCall = useCallback(
    async (action: Extract<Action, { kind: 'tool_call' }>): Promise<unknown> => {
      try {
        if (action.name === 'show_content') {
          const args = action.args as { html: string; kind: string };
          setContent({ html: args.html, kind: args.kind });
          setView(null);
          if (args.kind === 'question') {
            setTally((t) => ({ ...t, asked: t.asked + 1 }));
          }
          return { ok: true };
        }

        if (action.name === 'render_view') {
          const args =
            typeof action.args === 'object' && action.args !== null && !Array.isArray(action.args)
              ? (action.args as Record<string, unknown>)
              : {};
          const props = args.props;
          const parsed = ViewSpecSchema.safeParse({
            component: args.component,
            ...(typeof props === 'object' && props !== null && !Array.isArray(props)
              ? props
              : { props }),
          });

          if (!parsed.success) return { error: parsed.error.message };

          setView(parsed.data);
          setContent(null);
          return { ok: true };
        }

        const res = await callTool(action.name, action.args);
        if (res.error) return { error: res.error };

        if (action.name === 'record_result') {
          const args = action.args as { correct?: boolean };
          if (args.correct) {
            setTally((t) => ({ ...t, correct: t.correct + 1 }));
          }
        }
        if (action.name === 'record_result' || action.name === 'get_student_profile') {
          refreshSidebar();
        }
        return res.result;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Tool call failed' };
      }
    },
    [refreshSidebar]
  );

  // Handles one batch of actions from a single response.done event. Tool calls in the batch
  // are resolved in parallel, but every function_call_output is queued (sendToolOutput) BEFORE
  // the single response.create for the whole batch (client.requestResponse()) -- sending
  // response.create per-call races later calls in the same batch and can wedge the session.
  const handleActions = useCallback(
    (actions: Action[], client: RealtimeClient) => {
      const toolCalls = actions.filter((a): a is Extract<Action, { kind: 'tool_call' }> => a.kind === 'tool_call');
      const others = actions.filter((a) => a.kind !== 'tool_call');

      for (const action of others) {
        if (action.kind === 'user_transcript') {
          setTranscript((t) => [...t, { speaker: 'user', text: action.text }]);
        } else if (action.kind === 'bot_transcript') {
          setTranscript((t) => [...t, { speaker: 'bot', text: action.text }]);
          setModeBadge((m) => m ?? action.text.slice(0, 80));
        }
      }

      if (toolCalls.length === 0) return;

      toolBatchInFlightRef.current = true;
      void Promise.all(
        toolCalls.map(async (action) => ({ callId: action.callId, output: await resolveToolCall(action) }))
      )
        .then((results) => {
          for (const { callId, output } of results) {
            client.sendToolOutput(callId, output);
          }
          client.requestResponse();
        })
        .finally(() => {
          toolBatchInFlightRef.current = false;
        });
    },
    [resolveToolCall]
  );

  // Shared wiring for a freshly constructed client, used by both the initial manual connect and
  // every automatic reconnect attempt. `onDrop` is called at most once per client for whichever
  // signal (connectionstatechange or the data channel's own close) fires first -- handleDrop
  // itself is idempotent via dropHandledRef, but wiring it once here keeps that logic in one place.
  const wireClient = useCallback(
    (client: RealtimeClient, onDrop: (state: ConnectionDropState) => void) => {
      client.onEvent((event: ServerEvent) => {
        if (clientRef.current !== client) return; // late message from a superseded/dying client
        const raw = handleServerEvent(event);
        const actions = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        if (actions.length > 0) handleActions(actions, client);
      });
      client.onConnectionStateChange((state) => {
        if (clientRef.current !== client) return;
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          onDrop(state);
        }
      });
      client.onDataChannelClose(() => {
        if (clientRef.current !== client) return;
        onDrop('datachannel-closed');
      });
    },
    [handleActions]
  );

  // attemptReconnect, scheduleReconnect, and handleDrop form a cycle (a failed attempt schedules
  // the next one; a drop schedules the first one; a scheduled attempt calls back into itself on
  // failure). Each is called only through a ref updated by an effect below, so none of the
  // useCallback definitions needs to reference a not-yet-declared identifier.
  const handleDropRef = useRef<(state: ConnectionDropState) => void>(() => {});
  const scheduleReconnectRef = useRef<(attemptNumber: number) => void>(() => {});
  const attemptReconnectRef = useRef<(attemptNumber: number) => void>(() => {});

  const attemptReconnect = useCallback(
    async (attemptNumber: number) => {
      if (!audioRef.current || userDisconnectedRef.current) return;
      reconnectAttemptRef.current = attemptNumber;
      setReconnecting(true);
      setError(null);
      let client: RealtimeClient | undefined;
      try {
        client = new RealtimeClient(audioRef.current);
        wireClient(client, (state) => handleDropRef.current(state));
        clientRef.current = client;
        await client.connect({ resume: true });
        if (clientRef.current !== client) return; // superseded by a manual disconnect mid-flight
        dropHandledRef.current = false;
        reconnectAttemptRef.current = 0;
        setReconnecting(false);
        setConnected(true);
        setStartedAt(Date.now());
      } catch {
        if (userDisconnectedRef.current) return;
        if (shouldReconnect('failed', false, attemptNumber)) {
          scheduleReconnectRef.current(attemptNumber + 1);
        } else {
          setReconnecting(false);
          setConnected(false);
          // Symmetric with handleConnect's error path: tear down the failed client (stop the mic,
          // close whatever partially opened) rather than only dropping the ref and leaking it.
          client?.disconnect();
          clientRef.current = null;
          setError('Connection lost. Click Connect to reconnect.');
        }
      }
    },
    [wireClient]
  );
  useEffect(() => {
    attemptReconnectRef.current = (attemptNumber: number) => void attemptReconnect(attemptNumber);
  }, [attemptReconnect]);

  const scheduleReconnect = useCallback((attemptNumber: number) => {
    setReconnecting(true);
    const delay = getReconnectDelay(attemptNumber);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      attemptReconnectRef.current(attemptNumber);
    }, delay);
  }, []);
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  const handleDrop = useCallback(
    (state: ConnectionDropState) => {
      if (dropHandledRef.current || userDisconnectedRef.current) return;
      dropHandledRef.current = true;
      pauseElapsedTimer();
      setConnected(false);
      clientRef.current = null;

      const attemptsMade = reconnectAttemptRef.current;
      if (shouldReconnect(state, false, attemptsMade)) {
        scheduleReconnectRef.current(attemptsMade + 1);
      } else {
        setReconnecting(false);
        setError('Connection lost. Click Connect to reconnect.');
      }
    },
    [pauseElapsedTimer]
  );
  useEffect(() => {
    handleDropRef.current = handleDrop;
  }, [handleDrop]);

  const handleConnect = useCallback(async () => {
    if (!audioRef.current || connecting || connected || reconnecting) return;
    setError(null);
    setConnecting(true);
    userDisconnectedRef.current = false;
    dropHandledRef.current = false;
    reconnectAttemptRef.current = 0;
    cumulativeBaseRef.current = 0;
    try {
      const client = new RealtimeClient(audioRef.current);
      wireClient(client, (state) => handleDropRef.current(state));
      clientRef.current = client;
      await client.connect();
      setConnected(true);
      setStartedAt(Date.now());
      setElapsedMs(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      clientRef.current = null;
    } finally {
      setConnecting(false);
    }
  }, [connected, connecting, reconnecting, wireClient]);

  const handleDisconnect = useCallback(() => {
    userDisconnectedRef.current = true;
    clearPendingReconnect();
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
    setReconnecting(false);
    setError(null);
    setStartedAt(null);
    setElapsedMs(0);
    cumulativeBaseRef.current = 0;
    reconnectAttemptRef.current = 0;
    dropHandledRef.current = false;
  }, [clearPendingReconnect]);

  const sendQuestionPhoto = useCallback(
    async (file: File) => {
      const client = clientRef.current;
      if (!connected || !client) return;

      setError(null);
      if (!isAcceptedImageMime(file.type)) {
        setError('Question photo must be a JPEG, PNG, or WebP image.');
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('Question photo must be 8 MB or smaller.');
        return;
      }

      try {
        const dataUrl = await prepareImageDataUrl(file);
        // Wait out any tool-call batch that's between its sendToolOutput calls and its single
        // requestResponse() -- sendImage() below fires its own requestResponse(), and firing it
        // mid-batch would orphan that batch's outputs. See toolBatchInFlightRef above.
        await waitForToolBatch(() => toolBatchInFlightRef.current);
        if (clientRef.current !== client) {
          throw new Error('Photo was not sent because the session changed.');
        }
        client.sendImage(dataUrl, QUESTION_PHOTO_NOTE);
        setTranscript((lines) => [...lines, { speaker: 'user', text: '[photo sent]' }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send the question photo.');
      }
    },
    [connected]
  );

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void sendQuestionPhoto(file);
    },
    [sendQuestionPhoto]
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!connected) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void sendQuestionPhoto(file);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [connected, sendQuestionPhoto]);

  useEffect(() => {
    return () => {
      clearPendingReconnect();
      clientRef.current?.disconnect();
    };
  }, [clearPendingReconnect]);

  return (
    <div className="app">
      <audio ref={audioRef} autoPlay style={{ display: 'none' }} />

      <header className="app-header">
        <button
          type="button"
          className="connect-button"
          onClick={connected || reconnecting ? handleDisconnect : handleConnect}
          disabled={connecting}
        >
          {connected ? 'Disconnect' : connecting ? 'Connecting…' : reconnecting ? 'Cancel' : 'Connect'}
        </button>
        <input
          ref={fileInputRef}
          className="photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!connected}
          tabIndex={-1}
          onChange={handleFileSelect}
        />
        <button
          type="button"
          className="connect-button"
          disabled={!connected}
          onClick={() => fileInputRef.current?.click()}
        >
          📷 Add question photo
        </button>
        <span
          className={`status-pill status-pill--${connected ? 'connected' : reconnecting ? 'reconnecting' : 'disconnected'}`}
        >
          {connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Disconnected'}
        </span>
        {modeBadge && <span className="mode-badge">{modeBadge}</span>}
        <span className="elapsed-timer">{formatElapsed(elapsedMs)}</span>
        {error && (
          <span className="connect-error" role="alert">
            {error}
          </span>
        )}
      </header>

      <main className="app-main">
        <ContentPanel content={content} view={view} />
        <MasterySidebar profile={profile} tally={tally} />
      </main>

      <footer className="transcript-strip">
        {transcript.length === 0 && <p className="transcript-strip__empty">Transcript will appear here.</p>}
        {[...transcript].reverse().map((line, i) => (
          <p key={i} className={`transcript-line transcript-line--${line.speaker}`}>
            <strong>{line.speaker === 'user' ? 'You' : 'Examiner'}:</strong> {line.text}
          </p>
        ))}
      </footer>
    </div>
  );
}
