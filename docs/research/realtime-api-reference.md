# OpenAI Realtime API — Implementation Reference (verified August 2026)

Reference for the MCAT voice study bot: Next.js (App Router) server route mints an ephemeral
client secret; the browser connects to the Realtime API over WebRTC and drives function calling
over the data channel.

All endpoints, event names, and code below were verified against the live OpenAI docs on
2026-08-09. Note: `platform.openai.com/docs/*` now 301-redirects to
`https://developers.openai.com/api/docs/*` — link the new host in code comments.

Primary sources:

- Realtime overview: https://developers.openai.com/api/docs/guides/realtime
- WebRTC guide: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Conversations (incl. function calling): https://developers.openai.com/api/docs/guides/realtime-conversations
- Client secrets API reference: https://developers.openai.com/api/docs/api-reference/realtime-sessions
- Server events reference: https://developers.openai.com/api/docs/api-reference/realtime-server-events
- Voice agents guide: https://developers.openai.com/api/docs/guides/voice-agents
- Developer notes / gotchas: https://developers.openai.com/blog/realtime-api
- Pricing: https://developers.openai.com/api/docs/pricing

---

## 1. Current models

| Model | Use | Notes |
|---|---|---|
| **`gpt-realtime-2.1`** | **Voice agents — use this** | Current flagship speech-to-speech model; 128K context, 32K max output tokens; input text+audio+image, output text+audio. Improved alphanumeric recognition, silence/noise handling, interruption behavior; configurable reasoning effort. ([model page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)) |
| `gpt-realtime-2.1-mini` | Cheaper voice agents | Lower-cost variant (released alongside 2.1, ~July 2026). |
| `gpt-realtime`, `gpt-realtime-2` | Prior GA snapshots | Still accepted by the client-secrets endpoint; `gpt-realtime` was the Aug 2025 GA model. |
| `gpt-realtime-translate` | Live translation | Separate session type on `/v1/realtime/translations`. |
| `gpt-live-transcribe` | Realtime transcription only | Priced per minute, not per token. |

The voice-agents guide's own examples use `model: "gpt-realtime-2.1"`.

Transports: **WebRTC** (browser/mobile — our case), **WebSocket** (server-side audio pipelines),
**SIP** (telephony).

---

## 2. Ephemeral token minting (server side)

**Endpoint:** `POST https://api.openai.com/v1/realtime/client_secrets` (real API key stays here).
The full session configuration (model, instructions, voice, tools, VAD) is baked into the client
secret at mint time, so the browser never sends config with the real key.

Verbatim from the WebRTC guide (adapted only for Next.js route shape):

```ts
// app/api/realtime-token/route.ts
export async function POST() {
  const sessionConfig = JSON.stringify({
    session: {
      type: "realtime",
      model: "gpt-realtime-2.1",
      audio: {
        output: {
          voice: "marin",
        },
      },
      // instructions, tools, turn_detection etc. go here too — see sections 4–5
    },
  });

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "hashed-user-id", // optional but recommended
      },
      body: sessionConfig,
    }
  );
  const data = await response.json();
  return Response.json({ value: data.value, expires_at: data.expires_at });
}
```

**Response shape:**

```json
{
  "value": "ek_...",          // the ephemeral key the browser uses
  "expires_at": 1723200000,    // unix seconds
  "session": { "id": "sess_...", "object": "realtime.session", "type": "realtime", ... }
}
```

**Expiry** (`expires_after`, optional top-level field beside `session`):
`{ "anchor": "created_at", "seconds": N }` — default **600 s (10 min)**, min 10, max **7200 s**.
Expiry gates *starting* a connection; an already-established session continues past `expires_at`.
(Source: client-secrets API reference.)

Note: the old beta flow (`POST /v1/realtime/sessions` returning `client_secret.value`) is the
deprecated pre-GA interface. Use `/v1/realtime/client_secrets` only.

---

## 3. Browser WebRTC connection flow

**SDP exchange endpoint:** `POST https://api.openai.com/v1/realtime/calls`, authorized with the
**ephemeral** key, body is the raw SDP offer (`Content-Type: application/sdp`). No `?model=`
query param — the model is fixed by the client secret's session config.
**Data channel name: `"oai-events"`.**

Verbatim from the WebRTC guide:

```js
const pc = new RTCPeerConnection();

// Play remote (model) audio
const audioElement = document.createElement("audio");
audioElement.autoplay = true;
pc.ontrack = (e) => (audioElement.srcObject = e.streams[0]);

// Send mic audio
const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
pc.addTrack(ms.getTracks()[0]);

// Events flow over this data channel
const dc = pc.createDataChannel("oai-events");

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
  method: "POST",
  body: offer.sdp,
  headers: {
    Authorization: `Bearer ${EPHEMERAL_KEY}`,
    "Content-Type": "application/sdp",
  },
});
const answer = { type: "answer", sdp: await sdpResponse.text() };
await pc.setRemoteDescription(answer);

// Receive server events / send client events as JSON strings
dc.addEventListener("message", (e) => {
  const event = JSON.parse(e.data);
});
dc.send(JSON.stringify(event));
```

Over WebRTC, audio in both directions travels on the media tracks (never as base64 events);
only JSON events use the data channel.

---

## 4. Session configuration

Set at mint time (inside `session` in the client_secrets body) and/or updated live with a
`session.update` client event on the data channel. Key fields (client-secrets API reference):

- `type`: `"realtime"`
- `model`: `"gpt-realtime-2.1"`
- `instructions`: system-prompt text (e.g. `"Speak clearly and briefly. Confirm understanding before taking actions."`). Instructions + tools together capped at **16,384 tokens**.
- `output_modalities`: `["audio"]` (audio responses also carry a text transcript) or `["text"]`
- `max_output_tokens`: 1–4096 or `"inf"` (default `"inf"`)
- `audio.input`: `format` (PCM 24 kHz, PCMU, PCMA — WebRTC negotiates this for you), optional `noise_reduction` (`"near_field"` | `"far_field"`), `transcription` (see §6), `turn_detection`
- `audio.output`: `format`, `voice` — one of `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar` (docs recommend **`marin` or `cedar`** for best quality; **voice cannot change after the model first emits audio**), `speed` 0.25–1.5
- `tools`, `tool_choice` (`"none" | "auto" | "required"` or a specific function), `tracing`, `truncation`

**Turn detection** (`audio.input.turn_detection`):

```jsonc
// Option A: server VAD (silence-based)
{
  "type": "server_vad",
  "threshold": 0.5,            // 0.0–1.0
  "prefix_padding_ms": 300,
  "silence_duration_ms": 500,
  "create_response": true,     // auto-respond when speech stops
  "interrupt_response": true,  // barge-in interrupts active response
  "idle_timeout_ms": null      // optional: model re-engages after silence
}

// Option B: semantic VAD (model judges whether the user is done talking)
{
  "type": "semantic_vad",
  "eagerness": "auto",         // "low" (~8s) | "medium" (~4s) | "high" (~2s) | "auto"
  "create_response": true,
  "interrupt_response": true
}

// Option C: null — disables VAD entirely (push-to-talk; you commit buffers and
// call response.create yourself)
```

The conversations guide describes `semantic_vad` as the default behavior for current models;
`server_vad` is the classic silence-threshold mode. For a study bot where students pause to
think mid-answer, `semantic_vad` with `eagerness: "low"` is the natural pick.

---

## 5. Function calling (tools)

**Tool definition** — flat schema (no Chat-Completions-style `"function"` wrapper), in the
session config's `tools` array:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "get_flashcard",
      "description": "Fetch the next MCAT flashcard for the given topic.",
      "parameters": {
        "type": "object",
        "properties": {
          "topic": { "type": "string", "description": "MCAT topic, e.g. 'amino acids'" }
        },
        "required": ["topic"]
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Event flow on the data channel when the model calls a function:**

1. `response.function_call_arguments.delta` — argument JSON streams in.
2. `response.function_call_arguments.done` — arguments complete (carries `call_id`, `name`, full `arguments` string).
3. `response.done` — the response's `output` array contains an item with
   `"type": "function_call"`, `"name"`, `"arguments"` (JSON **string**), and `"call_id"`.
   Simplest robust pattern: parse function calls from `response.done`.

**Return the result, then ask for a new response** (two client events):

```js
dc.send(JSON.stringify({
  type: "conversation.item.create",
  item: {
    type: "function_call_output",
    call_id: callId,                    // must match the model's call_id
    output: JSON.stringify(result),     // string payload
  },
}));
dc.send(JSON.stringify({ type: "response.create" }));
```

Without the explicit `response.create`, the model does not speak the result. GA also supports
asynchronous function calling: the conversation can continue while a tool result is pending, and
the model auto-inserts placeholder speech instead of hallucinating a result
(source: developer notes blog).

Tool results can come from client code directly or from a round trip to your Next.js API —
either way they re-enter the session via the data channel event above. (MCP server tools can
also be declared in `tools` for server-executed tools.)

Sources: realtime-conversations guide (function-calling section), realtime-server-events reference.

---

## 6. Output handling, interruptions, transcription

**Text/audio output events** (data channel), in order:
`response.created` → `response.output_item.added` → `response.content_part.added` →
`response.output_text.delta` / `response.output_audio_transcript.delta` (streaming transcript of
the model's speech) → `...done` variants → `response.done`.
Over WebRTC the audio itself arrives on the remote media track; `response.output_audio.delta`
(base64 chunks) is a WebSocket-transport concern.

**Interruptions / barge-in:** with WebRTC, the server manages the output audio buffer, knows how
much has been played, and **automatically truncates unplayed audio on user interruption** — no
client bookkeeping needed (with `interrupt_response: true`). Manual controls exist if needed:
`response.cancel`, and `conversation.item.truncate` with `item_id` + `audio_end_ms` (required for
WebSocket clients after `input_audio_buffer.speech_started`).

**User speech transcription:** enable via session config:

```json
{ "audio": { "input": { "transcription": { "model": "whisper-1", "language": "en" } } } }
```

(the transcription block also accepts `prompt`/keywords; newer transcribe models are accepted as
`model`). Then listen for:

- `input_audio_buffer.speech_started` / `input_audio_buffer.speech_stopped`
- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed` (final user transcript)
- `conversation.item.input_audio_transcription.failed`

Transcription is asynchronous and separate from the model's own audio understanding — treat it
as UI/logging metadata, not ground truth for the model.

Also handle: `session.created`, `session.updated` (confirm config took), and `error`.

---

## 7. Pricing (verified 2026-08-09)

Per 1M tokens, from https://developers.openai.com/api/docs/pricing:

| Model | Audio in | Cached audio in | Audio out | Text in | Text out |
|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $32.00 | $0.40 | $64.00 | $4.00 | $24.00 |
| `gpt-realtime` | $32.00 | $0.40 | $64.00 | $4.00 | $16.00 |
| `gpt-realtime-mini` | $10.00 | $0.30 | $20.00 | $0.60 | $2.40 |
| `gpt-live-transcribe` | $0.017 / minute | — | — | — | — |

Rule of thumb: audio runs on the order of ~800 input tokens and ~1000 output tokens per minute
of speech, so a two-way conversation on `gpt-realtime-2.1` lands very roughly in the
**$0.05–$0.15/min** range depending on talk ratio and cache hits (input context re-sent each
turn is where cached-audio pricing at $0.40 matters). For a high-usage study bot,
`gpt-realtime-2.1-mini`/`gpt-realtime-mini` cuts this ~3x.

---

## 8. Gotchas

- **Token vs session lifetime:** the ephemeral key (default 10 min, max 2 h) only gates
  *starting* the WebRTC call; the session survives token expiry. Mint a fresh token per
  connection attempt — never reuse one across reconnects.
- **Session hard limit: 60 minutes** (raised from 30). There is no server-side "end at N
  minutes" setting — enforce your own cutoff client-side, and plan a clean "start new session"
  path. (Sources: developer notes blog; https://community.openai.com/t/how-to-limit-openai-realtime-api-sessions-to-x-minutes-max/1365611)
- **Context limits inside a session:** ~32,768-token window, max 4,096 tokens per response,
  ~28,672 max input; older turns are auto-truncated, which **busts the prompt cache**. Set
  `truncation` with `retention_ratio: 0.8` style config for long sessions (developer notes blog).
- **No state carryover / reconnection:** if the peer connection drops, there is no resume — mint
  a new token, open a new call, and re-seed context yourself (e.g. inject a summary via
  `conversation.item.create` or fold progress into `instructions`). Listen to
  `pc.connectionState` changes to detect drops.
- **Voice is locked** after the first audio output of a session.
- **Temperature is not a control surface** on realtime models — leave it at default (0.8) and
  steer with prompting; instructions are followed much more literally than in the 2024-era
  preview models, so keep them explicit.
- **Beta interface is deprecated:** anything referencing `POST /v1/realtime/sessions`,
  `client_secret.value`, top-level `modalities`, or `?model=` on the WebRTC URL is pre-GA
  (pre-Aug-2025) and should not be copied from old tutorials.
- **Docs host moved:** `platform.openai.com/docs` → `developers.openai.com/api/docs` (301).
- **Autoplay policy:** create/attach the `<audio>` element in response to a user gesture (the
  "start session" click) or the model's audio may be blocked by the browser.
- **Key hygiene:** the `ek_...` value is safe to hand to the browser but still grants a session
  on your bill for its TTL — rate-limit the minting route.
