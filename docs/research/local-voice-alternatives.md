# Local / Open-Source Alternatives to the OpenAI Realtime API (voice loop)

Researched 2026-08-10. Question: can the Realtime API voice loop in the MCAT tutor be
replaced with open-source models running on local hardware?

---

## 0. The actual hardware (from `~/admin/agent-infra/inventory.md`, verified 2026-07-16)

The fleet has **two** candidate machines — and the daily driver is *not* the M2:

| Machine | Chip / RAM | Role | Reachability |
|---|---|---|---|
| MacBook Air **M4, 32 GB** (Mac16,13) | 10-core M4 | Daily driver, roams home ↔ lab | self |
| MacBook Pro **M2 Max, 96 GB / 1 TB** | M2 Max | Heavy-lifter / shared workstation | `ssh m2max` (Tailscale SSH) or the LAN address |
| 2× Intel iMacs (24 GB) | Intel | MakerLab | Irrelevant for inference (no SSH, no GPU) |

The M2 Max already runs **Ollama** with `qwen3.5:35b-a3b` (23 GB, MoE), `gemma4:31b`
(19 GB), and `moondream` (1.7 GB vision). So "local" realistically means **inference on
the M2 Max 96 GB, client anywhere** — the M4 Air's 32 GB can host a ~30B MoE at 4-bit
in a pinch, but not while also running the browser, dev server, and 60-min sessions
comfortably.

**Two infrastructure caveats that gate any remote-but-local design (both documented in
inventory.md):**

1. **Tailnet TCP black-hole.** A leftover Tailscale GUI network extension on the M2 Max
   blocks **all non-SSH TCP over the tailnet** — Ollama `:11434`, or any voice-pipeline
   port, is unreachable remotely until `systemextensionsctl deactivate` is run once on
   the box. Until then, the M2 Max is only usable as a model host **from home LAN**.
2. **Sleep trap.** The box has a history of going to sleep when its keep-awake process
   dies (the Hermes incident). A voice tutor whose brain falls asleep mid-session is a
   real failure mode; the hardening steps in inventory.md must be done first.

Also: the M2 Max is **multi-tenant** (student workers `ash`, `chambe18`, `keshav` have
accounts). MCAT student data (mistake episodes, mastery) landing on a shared box is a
consideration, though milder than sending audio to OpenAI.

---

## 1. What must be replaced

From `docs/research/realtime-api-reference.md`, `lib/instructions.ts`, `lib/tools.ts`:

- **Full-duplex voice over WebRTC** with barge-in and **semantic VAD** (the session uses
  `semantic_vad`; the model decides when the student is done talking).
- **9 client-side tools called reliably and frequently**: `get_student_profile`,
  `generate_question`, `record_result`, `record_episode`, `recall_similar_mistakes`,
  `render_view`, `end_session_summary`, `record_feedback`, plus the display components —
  the instructions demand tool calls *after every question* and multi-tool sequences
  (missed question → `record_result` + `record_episode` + re-render `answer_grid`).
  **This is the hard requirement.** A model that drops or garbles 5% of tool calls
  breaks the mastery/spaced-rep data the whole app is built on.
- **Image input**: student photographs a practice question; the model must read it,
  classify its MCAT category, and run a post-mortem.
- **~1 s voice-to-voice latency**, 60+ minute sessions, reconnect handling.
- Separately: `generate_question` already runs as its own chat-completions call to a
  reasoning model — the "brain" and the "voice" are already decoupled, which matters
  below.

---

## 2. OSS speech-to-speech models (single-model, Realtime-API-style)

State of the field as of Aug 2026 (good survey: [Speech-to-Speech Models in 2026
](https://ai.ksopyla.com/posts/voice-to-voice-models-2026-review/)):

| Model | Size | Latency | Tool calling | Image input | M2 Max feasible? |
|---|---|---|---|---|---|
| **Kyutai Moshi** | 7B + Mimi codec | ~160–200 ms, true full-duplex | **No** (chat-only, one voice, no function-call head) | No | Yes (MLX port exists) — but useless for this app |
| **NVIDIA PersonaPlex** (Jan 2026, Moshi-based) | ~7B | ~205 ms, 100% interruption success | **No reliable tool calling** | No | CUDA-first; not the point anyway |
| mini-omni / LLaMA-Omni / GLM-voice line | 7–9B | sub-second | No / demo-grade | No | Research demos; none ship a production tool-calling story |
| **Qwen2.5-Omni → [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) → Qwen3.5-Omni** (thinker–talker) | 3B–30B-A3B class | ~257 ms (on datacenter GPUs) | **Yes — the only line with native tool calling** + 128K context | **Yes** (image/video/audio) | Weights fit in 96 GB, but real-time streaming speech serving is vLLM/CUDA-tuned; no production-grade MLX *realtime speech* path on Apple Silicon yet (MLX covers Qwen3-ASR/TTS/VL as separate models) |

**Bottom line:** the only OSS S2S family that can even *attempt* the 9-tool +
image-input job is Qwen's Omni line, and its low-latency streaming path assumes NVIDIA
serving. On an M2 Max you'd be running it in a degraded, non-realtime mode. No
Moshi-derivative can do function calling at all. **A single-model local substitute for
`gpt-realtime-2.1` does not exist on Apple Silicon in Aug 2026.** Even the survey
author's conclusion is that cascaded pipelines remain "the most practical architecture"
for knowledge-grounded agents.

---

## 3. Cascaded local pipeline (STT → LLM → TTS) on the M2 Max

This is the realistic local architecture. Component picks, best-first:

- **STT**: [Kyutai STT](https://kyutai.org/stt/) (streaming, MLX build available,
  designed for exactly this) or **Parakeet-MLX** / whisper.cpp `large-v3-turbo` with
  Metal. All comfortably real-time on M2 Max; whisper.cpp uses <1 GB. Qwen3-ASR also
  has [native MLX runtimes](https://github.com/drguptavivek/qwen3-asr-mlx-runtime).
- **VAD / turn-taking**: Silero VAD + **pipecat's smart-turn model** (a small local
  model judging semantic completeness — the OSS analogue of `semantic_vad`). This is a
  solved problem locally.
- **LLM**: **`qwen3.5:35b-a3b` — already pulled on the M2 Max.** MoE with ~3B active
  params, so decode is fast: comparable A3B MoEs do 60–130 tok/s on Apple Silicon
  ([M4 Pro benchmarks](https://modelpiper.com/blog/local-llm-benchmarks-apple-silicon),
  [MLX vs llama.cpp](https://yage.ai/share/mlx-apple-silicon-en-20260331.html)); the M2
  Max's 400 GB/s bandwidth is in the same class. Qwen3-class models are the standard
  recommendation for local tool calling. With 96 GB, a dense 32B or even 70B-class
  4-bit fits, trading speed for quality. Ollama ≥0.31's MLX backend (multi-token
  prediction) helps further.
- **TTS**: **Kokoro** (82M, ONNX/CPU, near-instant, the default 2026 pick),
  **[Qwen3-TTS on MLX](https://github.com/kapi2800/qwen3-tts-apple-silicon)** (better
  voices, voice cloning, ~4 GB), or Piper (fastest, robotic). F5-TTS/XTTS: quality-first
  but too slow to first-audio for conversation.
- **Vision (photo questions)**: needs a separate VLM call — Qwen3.5-VL 30B-A3B on the
  same box. `moondream` (already installed) is too weak to read an MCAT passage +
  diagram reliably. This adds 5–15 s per photo locally.

**Realistic end-to-end latency on the M2 Max**: turn-end detection (~200 ms) + STT
finalize (~100–300 ms) + LLM time-to-first-token (~300–800 ms for a 35B-A3B with a long
tutor system prompt + conversation history; prompt re-processing is the Apple Silicon
weak spot) + TTS time-to-first-audio (~100–300 ms Kokoro). **≈ 1.2–2.5 s voice-to-voice
in the good case**, worse as the 60-min session's context grows (prompt prefill scales
with history; aggressive KV-cache reuse mitigates). That's 2–4× the Realtime API's
feel, and turns that trigger a tool round-trip (most turns, per the instructions)
add a full extra LLM pass.

---

## 4. Orchestration frameworks / Realtime-API shims

- **[pipecat](https://docs.pipecat.ai/server/services/llm/ollama)** — best-supported
  path. Has first-class `OLLamaLLMService` (OpenAI-compatible, function calling passes
  through), Whisper STT, Kokoro TTS, Silero VAD, smart-turn, WebRTC transport
  (SmallWebRTC / Daily), interruption/barge-in handling built in. You'd run the pipecat
  server on the M2 Max and rewrite `lib/realtime-client.ts` against its client SDK.
- **[HuggingFace speech-to-speech](https://github.com/huggingface/speech-to-speech)** —
  modular VAD→STT→LLM→TTS exposing an **OpenAI Realtime-compatible WebSocket at
  `ws://localhost:8765/v1/realtime`** (Parakeet STT + any OpenAI-compatible LLM + Qwen3-TTS).
  Closest thing to a drop-in shim.
- **[LocalAI](https://github.com/mudler/LocalAI)** — advertises a Realtime API
  (audio-to-audio) **with tool calling** as part of its drop-in OpenAI compatibility;
  single binary, runs on Metal. Worth a spike, but its realtime endpoint is younger and
  less battle-tested than pipecat.
- **LiveKit Agents (self-hosted)** — production-grade WebRTC + agent framework, plugs
  into local STT/LLM/TTS; heavier ops (LiveKit server + agent workers) than pipecat for
  a single-user app.
- **[open-gpt-live](https://github.com/study8677/open-gpt-live)** — OSS realtime voice
  gateway (adaptive VAD, interruptible TTS) with an experimental Ollama/faster-whisper/
  Kokoro local profile.

**Client-code survival is partial at best.** The current client speaks **WebRTC with
the `oai-events` data channel and GA event names** (`response.function_call_arguments.done`,
`conversation.item.create`, semantic VAD config, image `input_image` items). The shims
are WebSocket-first and emulate varying subsets of the event protocol — image input and
semantic-VAD config are exactly the corners emulators miss. Budget for rewriting
`lib/realtime-client.ts`'s transport layer regardless of which shim is chosen; the tool
dispatch/handler layer (`lib/tools.ts` handlers) survives untouched.

**Network reality check:** the browser client must reach the M2 Max. At home (LAN)
fine; away from home the tailnet black-hole (§0) blocks every port a voice pipeline
would use until the network-extension fix is applied on the box. A roaming study
session on the M4 Air with the model on the M2 Max is **not currently possible**.

---

## 5. Cost/benefit and the honest quality gap

**Current spend:** $0.05–0.15/min ⇒ a daily 60-min session costs $3–9/day, so
**$40–$130 total between now and the Aug 23 exam**. That is the entire sum the local
migration can save.

**Quality gap (the part that matters for MCAT):**

- *Tool calling*: frontier hosted models sit ~76% on BFCL v3
  ([leaderboard](https://pricepertoken.com/leaderboards/benchmark/bfcl-v3)); local
  30B-class models trail meaningfully, and this app's bar is unusually high — 9 tools,
  multi-call sequences after every question, strict schemas (`record_episode` with
  7 fields), 60 minutes without drift. Expect visibly more dropped/malformed calls,
  i.e. silent corruption of the mastery and spaced-rep data.
- *Content accuracy*: the student is at the 93rd percentile; the tutor's job is the
  last 4 points. A 35B-A3B model explaining amino-acid pKa edge cases will be
  confidently wrong more often than `gpt-realtime-2.1` + the reasoning-model
  `generate_question` path. Wrong science delivered fluently is the worst possible
  failure mode two weeks before the exam.
- *Voice*: Kokoro/Qwen3-TTS are good but the pipeline loses the Realtime API's
  prosody-aware listening (the TONE instructions — detecting frustration/fatigue from
  the voice — die entirely in a cascaded pipeline: the LLM only ever sees a transcript).
- *Photo questions*: local VLM reading of photographed passages is the weakest link.

---

## 6. Verdict

**Keep the Realtime API through the Aug 23 exam. Do not migrate.** The total remaining
API spend (≈$40–130) is far below the cost of a week of integration work, and every
axis that matters to the exam — tool-call reliability, content accuracy, tone
awareness, photo questions, latency — gets worse locally. The two weeks before an MCAT
are the wrong time to swap the engine.

**If local is insisted on anyway (post-exam project):**

- Architecture: **pipecat server on the M2 Max 96 GB** (after the network-extension fix
  and sleep hardening) — Kyutai STT or whisper.cpp (Metal) + Silero VAD + smart-turn +
  **`qwen3.5:35b-a3b` via Ollama** (already installed) + Kokoro or Qwen3-TTS-MLX;
  Qwen3.5-VL for photo questions; rewrite `lib/realtime-client.ts`'s transport against
  pipecat (or spike the HF speech-to-speech Realtime-compatible WebSocket first).
- Expected tradeoffs: **1.2–2.5 s voice-to-voice** (vs ~1 s today), degrading over long
  sessions; noticeably less reliable multi-tool sequences; loss of vocal-tone
  adaptation; home-LAN-only until the tailnet fix.
- Skip entirely: single-model S2S substitutes. Moshi/PersonaPlex can't call tools;
  Qwen3-Omni is the only candidate and its realtime path isn't production-ready on
  Apple Silicon.

**Most sensible hybrid** (if the goal is cost, not privacy): keep the Realtime API for
the voice loop and point only the *text brain* (`generate_question`, embeddings) at the
M2 Max via Ollama's OpenAI-compatible endpoint — those calls are already separate
chat-completions requests, so the swap is a base-URL change. It saves the smaller half
of the bill, though, and a local 35B writing calibrated MCAT items is a quality
downgrade on the app's most quality-sensitive call — so even the hybrid is best
deferred until after Aug 23.

---

## Sources

- Fleet inventory: `~/admin/agent-infra/inventory.md`
- [Speech-to-Speech Models in 2026 — architecture survey](https://ai.ksopyla.com/posts/voice-to-voice-models-2026-review/)
- [Moshi realtime speech guide](https://localaimaster.com/blog/moshi-realtime-speech-guide) · [Kyutai STT](https://kyutai.org/stt/) · [kyutai-labs/unmute](https://github.com/kyutai-labs/unmute) · [delayed-streams-modeling (MLX)](https://github.com/kyutai-labs/delayed-streams-modeling)
- [QwenLM/Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) · [Qwen3-TTS on Apple Silicon (MLX)](https://github.com/kapi2800/qwen3-tts-apple-silicon) · [Qwen3-ASR MLX runtime](https://github.com/drguptavivek/qwen3-asr-mlx-runtime)
- [Local voice stack on Apple Silicon (Whisper+Ollama+Kokoro)](https://dev.to/xadenai/building-a-local-voice-ai-stack-whisper-ollama-kokoro-tts-on-apple-silicon-eo0) · [Every Local AI stack guide](https://everylocalai.com/stack/local-voice-assistant)
- [pipecat Ollama LLM service](https://docs.pipecat.ai/server/services/llm/ollama) · [On-prem voice agents with Pipecat (webrtc.ventures)](https://webrtc.ventures/2025/03/on-premise-voice-ai-creating-local-agents-with-llama-ollama-and-pipecat/)
- [huggingface/speech-to-speech (Realtime-compatible WS)](https://github.com/huggingface/speech-to-speech) · [LocalAI](https://github.com/mudler/LocalAI) · [open-gpt-live](https://github.com/study8677/open-gpt-live)
- [Apple Silicon LLM benchmarks](https://modelpiper.com/blog/local-llm-benchmarks-apple-silicon) · [MLX vs llama.cpp on Apple Silicon](https://yage.ai/share/mlx-apple-silicon-en-20260331.html) · [BFCL v3 leaderboard](https://pricepertoken.com/leaderboards/benchmark/bfcl-v3)
