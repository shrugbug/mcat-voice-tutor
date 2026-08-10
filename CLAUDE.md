@AGENTS.md

# MCAT study bot

## Run commands

- `npm run dev` — Next.js dev server (localhost:3000), required by everything below.
- `npm run seed -- --cp <score> --cars <score> --bb <score> --ps <score>` — seed taxonomy +
  initialize per-category mastery from real AAMC section scores. `npm run seed -- --taxonomy-only`
  seeds categories at mastery 0.5 with no scores.
- `npm run ingest -- pdfs/*.pdf` — chunk + embed PDFs into `data/mcat.db` (`--force` to
  re-ingest, `--dry-run` to skip embeddings/writes). Requires poppler (`brew install poppler`).
- `npm run acceptance` — scripted tool-loop acceptance (`scripts/acceptance.ts`) against a
  running dev server. Not a vitest test; run it manually.
- `npx vitest run` — unit/integration test suite.
- `npx tsc --noEmit` — typecheck.

## Env vars (`.env`, see `.env.example`)

- `OPENAI_API_KEY` — required for question generation and the realtime voice session.
- `QUESTION_MODEL` (default `gpt-5.1`) — model used by `lib/questions.ts` for question generation.
- `REALTIME_MODEL` (default `gpt-realtime-2.1`) — model used by the WebRTC realtime voice client.

## Ground truth

`docs/research/realtime-api-reference.md` is the API ground truth for the OpenAI Realtime API —
prefer it over training knowledge or assumptions when touching `lib/realtime-client.ts` or
session/event handling.

## Data

- `data/mcat.db` — sqlite db (categories, results, sessions, chunks). Gitignored; created by
  `openDb()` on first run, populated by `npm run seed` / `npm run ingest`.
- `resources/` — downloaded study PDFs with a manifest. Gitignored.
- `pdfs/` — the user's own study materials, ingested the same way. Gitignored.

## Pending (deferred until user has API key/scores/PDFs)

- Scored seed run (`npm run seed -- --cp ... --cars ... --bb ... --ps ...`) with the user's real
  AAMC section scores — currently only taxonomy-only seeding has been run.
- Real `npm run ingest` over `resources/` and/or `pdfs/`.
- Live smoke test (`npm run acceptance`) and the live voice checklist
  (`docs/superpowers/plans/acceptance-checklist.md`) with the user, mic-enabled.

## Session Log

### 2026-08-10
- Completed: Full build from empty repo — voice examiner (Realtime API + reasoning-model question brain), student model w/ episodic memory + spaced rep, PDF RAG (7 resources ingested), render_view generative UI, photo-of-question input, seamless reconnect, morning-briefing (7:30a) + nightly-tuner (11p) launchd jobs, Aryan-personalized landing page. 180 tests. Repo published private w/ arluigi collaborator.
- Next: Aryan's section scores → scored seed (`npm run seed -- --cp N --cars N --bb N --ps N`); apply first nightly tuning proposal from docs/tuning/; optionally trust `devin` interactively for future agent work.
