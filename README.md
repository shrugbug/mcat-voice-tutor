# MCAT Voice Tutor

A speech-to-speech oral examiner for MCAT preparation. You talk to it; it drills you, diagnoses
what you got wrong and why, remembers your mistakes across sessions, and escalates difficulty as
you improve.

Built on the **OpenAI Realtime API over WebRTC**, with a ten-tool function-calling layer over a
SQLite learner model.

---

## Requirements

- **Node.js 20+** (developed on 22)
- An **OpenAI API key** with Realtime API access
- A Chromium-based browser (Chrome or Edge) — the app uses `getUserMedia` and WebRTC

> **Cost note:** the Realtime API is billed per minute of audio and is not cheap. A few short
> test sessions cost dollars, not cents. Don't leave a session open.

## Setup

```bash
npm install

cp .env.example .env      # then edit .env and set OPENAI_API_KEY

npm run seed              # creates the local SQLite database
npm run dev               # http://localhost:3000
```

Open `http://localhost:3000` in Chrome and allow microphone access when prompted. `localhost`
counts as a secure origin, so the mic works without HTTPS locally — **any other host needs
HTTPS or the browser will refuse microphone access.**

### Environment variables

`.env` is gitignored; `.env.example` is committed and lists every variable the app reads. Copy
the example and fill it in — never commit the real file.

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | **yes** | Server-side only. Used to mint short-lived client secrets; never sent to the browser. |
| `QUESTION_MODEL` | no | Reasoning model for question generation. Default `gpt-5.1`. |
| `REALTIME_MODEL` | no | Speech-to-speech model. Default `gpt-realtime-2.1`. |
| `NEXT_PUBLIC_EXAM_DATE` | no | Target exam date, shown in the UI. |
| `MCAT_DB` | no | Database path. Lets one checkout serve multiple instances. |
| `MCAT_INSTANCE` | no | Instance label (`prod`, `demo`) used for Sentry tags. Defaults to `prod`. |
| `SENTRY_*`, `NEXT_PUBLIC_SENTRY_DSN` | no | Error monitoring. Everything is inert when the DSN is unset. |

## How it works

The browser talks to OpenAI **directly** over WebRTC. This server is not in the audio path — it
appears twice: once before the call to mint a credential, and once per tool call during it.

1. The browser requests `GET /api/session`. The server exchanges its real API key for an
   **ephemeral client secret**, with the model, instructions, tools, turn detection, and voice
   all baked in at mint time. The real key never reaches the browser, and a client cannot alter
   the session configuration.
2. The browser opens an `RTCPeerConnection`, attaches the microphone, and creates a data channel
   named `oai-events` — **before** creating the SDP offer, so the channel is part of the
   negotiated description.
3. It POSTs the SDP offer to OpenAI and applies the answer. Audio then flows over media tracks;
   tool calls and transcripts flow over the data channel.
4. Tool calls are dispatched to `POST /api/tool`, which validates and runs them against SQLite.

Turn-taking uses `semantic_vad` with `eagerness: 'low'` — turn ends are judged by meaning rather
than a silence threshold, which suits a student pausing mid-thought — and `interrupt_response`
enables barge-in. A separate `whisper-1` transcription config is required to receive text
transcript events; without it the model still understands speech, but no transcript is produced.

**One non-obvious rule:** when a single response carries several parallel tool calls, every
`function_call_output` must be queued *before* one `response.create` is sent for the whole batch.
Sending `response.create` per call lets the model start replying before later calls are
acknowledged, which wedges the session.

### Layout

| Path | Contains |
|---|---|
| `lib/realtime-client.ts` | WebRTC negotiation, event normalization, reconnect policy |
| `lib/instructions.ts` | The examiner persona and tool-usage protocol |
| `lib/tools.ts` | `TOOL_DEFS` (ten tools) and `dispatchTool` |
| `lib/rag.ts`, `lib/embeddings.ts` | Chunking, embeddings, similarity search |
| `lib/db.ts`, `lib/student.ts` | Schema and the learner model |
| `app/api/session` | Ephemeral credential minting |
| `app/api/tool` | Tool dispatch, validation, error capture |
| `app/page.tsx` | Orchestration — the tool batch loop and the single `requestResponse()` |

## Reliability

- **Reconnect** is handled at two layers. Transport: up to 3 attempts with 1s/5s/15s backoff,
  watching both peer-connection state *and* data-channel close (the 60-minute server session cap
  closes the channel without necessarily changing connection state). Prompt: `instructions.ts`
  tells the model to recap in one sentence and not re-greet.
- **Tool failures** return structured errors the model can recover from and are recorded to the
  database, rather than throwing inside the data-channel handler.
- **Sentry** is optional and scrubs PII before sending.

## Tests

```bash
npx vitest run          # all tests
npx vitest              # watch mode
```

There is no `npm test` script; vitest is invoked directly. Tests live in `tests/` and cover event
handling, reconnect logic, tool errors, retrieval, and the data pipeline.

```bash
npm run lint            # eslint
npm run acceptance      # end-to-end acceptance script
```

## Scripts

| Command | Does |
|---|---|
| `npm run seed` | Create and populate the local database |
| `npm run ingest` | Ingest study PDFs into the retrieval corpus |
| `npm run import-exam` | Import an AAMC score report into the learner model |
| `npm run briefing` | Generate a study briefing |
| `npm run pull` | Pull WAL-safe database snapshots from the server |
| `npm run combine` | Merge pulled snapshots into one analysis database |
| `npm run tune` | Generate a tuning proposal from recent session data |

`npm run tune` writes a **proposal** to `docs/tuning/`. It never edits `lib/instructions.ts` —
instruction changes are applied by a human.

## Data and privacy

`data/*.db`, `pdfs/`, `resources/`, and `data/remote/` are gitignored. Study materials and
student records are never committed. See
[`docs/decisions/2026-08-11-corpus-licensing.md`](docs/decisions/2026-08-11-corpus-licensing.md)
for the provenance analysis of the retrieval corpus.

## More

- [`docs/operations.md`](docs/operations.md) — deployed instances, deploy flow, backups, the
  nightly pipeline
- [`docs/research/realtime-api-reference.md`](docs/research/realtime-api-reference.md) — verified
  notes on the Realtime API
- [`docs/research/local-voice-alternatives.md`](docs/research/local-voice-alternatives.md) —
  build-vs-buy analysis of open-source speech-to-speech and cascaded pipelines, with latency
  budgets

## Known gaps

- **No latency instrumentation.** Voice-to-voice latency is not measured.
- One open dependency advisory (`fast-uri`, via the Sentry webpack plugin) — build-time only, not
  reachable from user input.
- The reverse-proxy configuration that routes hostnames to ports on the server is not documented
  in this repo.
