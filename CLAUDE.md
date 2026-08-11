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

### 2026-08-10 (part 3)
- Verified the Jarvis wave (WS-A/B/C + wave 2) is fully shipped on main: episodes + spaced rep,
  reconnect, briefing/tuner, photo input, unified instructions, launchd jobs w/ sentinels.
- Key finding: the nightly tuner reads LOCAL `data/mcat.db` (5 synthetic results) while all real
  usage sits in two VPS databases (prod: 32 transcripts + 4 feedback; demo: 30 transcripts). They
  have never met — so `proposal-2026-08-10.md` was built on synthetic data and its UI/UX section
  says "no feedback today" while four real items sat unread on the VPS.
- Also found: `data_table` caps at 30 rows vs 34 categories (confirmed root cause of the
  curriculum-overview failure Aryan hit twice); `/api/tool` swallows every tool error unlogged;
  the demo mic is capturing bystander room audio into a public db.
- Specced the fix — 5 workstreams on `feat/tuning-loop-and-interfaces` (pushed, no PR yet):
  `docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md`. Approved, not yet
  implemented. Worktree at `../mcat-tuning-loop`.
- DECLINED: `docs/tuning/proposal-2026-08-10.md` is **shelved, not pending** — over-fit to 5
  synthetic attempts. Do not apply; do not resume without asking. The first proposal worth acting
  on is the one generated after WS-1 lands.
- Next: user creates Sentry project + sets SENTRY_DSN/SENTRY_AUTH_TOKEN (blocks nothing, but WS-5
  can't run without it); write the implementation plan for the spec; user buys mcat.coach then
  DNS+cert; Aryan's section scores -> scored seed; review feature/multi-user-launch specs
  (licensing blocker: KA-derived corpus is CC BY-NC); 8 skill-audit flags.