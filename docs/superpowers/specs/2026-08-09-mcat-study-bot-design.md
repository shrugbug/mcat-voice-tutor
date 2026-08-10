# MCAT Study Bot — Design Spec

**Date:** 2026-08-09
**Status:** Approved by user (brainstorming session)
**Context:** User is 8 weeks into MCAT prep, exam in ~2 weeks (late August 2026), scoring 93rd percentile on practice exams. Goal: a voice study bot that finds and hammers the remaining weaknesses to break the plateau. Personal use, local only.

## Product

A voice-first oral examiner built on the OpenAI Realtime API, run locally as a Next.js app on the user's laptop. The bot adaptively chooses between three session modes based on tracked performance:

1. **Oral drill** — rapid-fire adaptive questioning; probes until it finds a gap, then hammers it with progressively harder questions and "why" follow-ups.
2. **Teach-back examiner** — user explains a concept aloud; bot interrupts with edge cases, challenges imprecise statements, demands mechanisms.
3. **Verbal exam simulation** — MCAT-style passage + questions, timed, followed by a distractor-level post-mortem.

The bot announces which mode it picked and why at session start.

## Architecture

**Voice + brain split.** The Realtime API (`gpt-realtime`) owns the conversation: voice, pacing, interruptions, probing. Hard question authoring is delegated to a strong reasoning text model (GPT-5.x) via a tool call, because realtime speech models cap out below the rigor needed to challenge a 93rd-percentile student. The reasoning model returns question + correct answer + per-distractor rationale; the voice agent delivers and grills.

**Stack.** Next.js (App Router), run with `npm run dev`, never deployed. Browser ↔ Realtime API over WebRTC; an ephemeral session token is minted by a server route so the OpenAI key stays in `.env`. SQLite (single file in repo, gitignored) for the student model and PDF index.

### Tools exposed to the voice agent

| Tool | Backing | Purpose |
|---|---|---|
| `get_student_profile` | SQLite | Per-topic mastery, error-type history, last-session summary. Called at session start to pick mode/topics. |
| `record_result` | SQLite | After each question: topic, difficulty, correct/incorrect, error type (content gap / reasoning slip / misread). |
| `generate_question` | Reasoning model (GPT-5.x) via server route | Returns passage/stem, options, correct answer, distractor rationales for a given topic + difficulty + style. |
| `search_materials` | RAG over indexed PDFs | Ground passages in the user's textbook; sanity-check generated content. |
| `show_content` | Client-side render | Displays passages, diagrams, equations, answer options on screen. Bot reads stems aloud; visual material displays — much of Chem/Phys is uninterpretable by ear. |
| `end_session_summary` | SQLite | Writes session summary + updated focus recommendations for next session pickup. |

## Student model

- **Taxonomy:** AAMC official content outline (10 foundational concepts, freely published) fetched by a research agent and stored as the topic tree. This matches what the real exam scores against.
- **Seed:** user's section-level practice scores (Chem/Phys, CARS, Bio/Biochem, Psych/Soc), entered once.
- **Update:** every `record_result` adjusts a per-topic mastery estimate and accumulates error-type tags. Simple estimator (e.g., exponentially weighted accuracy by topic × difficulty) — no over-engineered IRT.
- **Persistence:** SQLite; survives across sessions so the bot resumes where it left off.

## PDF ingestion

One-time script (`scripts/ingest.ts` or similar): extract text from the user-provided textbook and sample-exam PDFs → chunk → embed (OpenAI embeddings) → store vectors in SQLite. `search_materials` does cosine top-k. Re-runnable when new PDFs are added. Supplementary free resources found by research agents may be indexed the same way.

## Research agents (run in parallel with build)

1. AAMC content outline → topic taxonomy JSON.
2. Current OpenAI Realtime API docs: WebRTC connection flow, ephemeral tokens, tool-calling schema (API changed substantially through 2025 — do not code from memory).
3. Survey of free high-yield MCAT resources worth indexing.

## Error handling

- Tool call fails → bot states it briefly and continues from its own knowledge; never silently stalls.
- WebRTC drop → UI shows reconnect button; session state is server-side in SQLite so nothing is lost.
- `generate_question` timeout (reasoning models are slow) → bot fills the gap conversationally ("while that loads, quick one: …") using a cheap fallback question from its own knowledge.

## Testing

- Unit tests for each tool route with real fixture data (per CLAUDE.md: fixtures must be checked against real API payloads, not invented to match the code).
- Ingestion script tested against the actual user PDFs, not synthetic text.
- Acceptance: a scripted session transcript that exercises every tool end-to-end.
- UI verified at laptop widths; mobile is out of scope (user chose laptop-only).

## Out of scope (YAGNI)

- Deployment, auth, rate limiting (local only).
- Mobile/phone-friendly UI.
- Multi-user support.
- Spaced-repetition scheduling beyond the mastery-driven topic picker.
- CARS passage authoring from copyrighted sources — generated passages only, grounded in style not text.
