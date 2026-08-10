'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeClient, handleServerEvent, type Action, type ServerEvent } from '@/lib/realtime-client';
import type { Profile } from '@/lib/student';
import ContentPanel, { type DisplayContent } from './components/ContentPanel';
import MasterySidebar, { type Tally } from './components/MasterySidebar';

type TranscriptLine = { speaker: 'user' | 'bot'; text: string };

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

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState<DisplayContent | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tally, setTally] = useState<Tally>({ asked: 0, correct: 0 });
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [modeBadge, setModeBadge] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const refreshSidebar = useCallback(() => {
    void callTool('get_student_profile', {}).then((res) => {
      if (res.result) setProfile(res.result as Profile);
    });
  }, []);

  // Show seeded categories even before connecting.
  useEffect(() => {
    refreshSidebar();
  }, [refreshSidebar]);

  // Elapsed session timer.
  useEffect(() => {
    if (!connected || startedAt === null) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [connected, startedAt]);

  const handleAction = useCallback(
    (action: Action, client: RealtimeClient) => {
      switch (action.kind) {
        case 'tool_call': {
          if (action.name === 'show_content') {
            const args = action.args as { html: string; kind: string };
            setContent({ html: args.html, kind: args.kind });
            if (args.kind === 'question') {
              setTally((t) => ({ ...t, asked: t.asked + 1 }));
            }
            client.sendToolResult(action.callId, { ok: true });
            return;
          }

          void callTool(action.name, action.args).then((res) => {
            client.sendToolResult(action.callId, res.error ? { error: res.error } : res.result);
            if (action.name === 'record_result') {
              const args = action.args as { correct?: boolean };
              if (args.correct) {
                setTally((t) => ({ ...t, correct: t.correct + 1 }));
              }
            }
            if (action.name === 'record_result' || action.name === 'get_student_profile') {
              refreshSidebar();
            }
          });
          return;
        }
        case 'user_transcript':
          setTranscript((t) => [...t, { speaker: 'user', text: action.text }]);
          return;
        case 'bot_transcript':
          setTranscript((t) => [...t, { speaker: 'bot', text: action.text }]);
          setModeBadge((m) => m ?? action.text.slice(0, 80));
          return;
      }
    },
    [refreshSidebar]
  );

  const handleConnect = useCallback(async () => {
    if (!audioRef.current || connecting || connected) return;
    setError(null);
    setConnecting(true);
    try {
      const client = new RealtimeClient(audioRef.current);
      clientRef.current = client;
      client.onEvent((event: ServerEvent) => {
        const raw = handleServerEvent(event);
        const actions = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        for (const action of actions) {
          handleAction(action, client);
        }
      });
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
  }, [connected, connecting, handleAction]);

  const handleDisconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
    setStartedAt(null);
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="app">
      <audio ref={audioRef} autoPlay style={{ display: 'none' }} />

      <header className="app-header">
        <button
          type="button"
          className="connect-button"
          onClick={connected ? handleDisconnect : handleConnect}
          disabled={connecting}
        >
          {connected ? 'Disconnect' : connecting ? 'Connecting…' : 'Connect'}
        </button>
        {modeBadge && <span className="mode-badge">{modeBadge}</span>}
        <span className="elapsed-timer">{formatElapsed(elapsedMs)}</span>
        {error && <span className="connect-error">{error}</span>}
      </header>

      <main className="app-main">
        <ContentPanel content={content} />
        <MasterySidebar profile={profile} tally={tally} />
      </main>

      <footer className="transcript-strip">
        {transcript.length === 0 && <p className="transcript-strip__empty">Transcript will appear here.</p>}
        {transcript.map((line, i) => (
          <p key={i} className={`transcript-line transcript-line--${line.speaker}`}>
            <strong>{line.speaker === 'user' ? 'You' : 'Examiner'}:</strong> {line.text}
          </p>
        ))}
      </footer>
    </div>
  );
}
