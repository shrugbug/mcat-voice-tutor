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

### 2026-08-16
- Completed: read-only voice-implementation research (for a separate MVP); pulled the 7 commits
  this checkout was missing (PRs #1-#7 from 2026-08-11); reconciled pre-existing uncommitted
  local Sentry work against PR #7's already-shipped, PII-scrubbed instrumentation, adding only
  what was missing (`next.config.ts` source-map upload via `withSentryConfig`, `app/global-error.tsx`,
  `SENTRY-VPS-SETUP.sh`). Codex review of that work caught and fixed two real bugs (P1: bad
  auth-token fallback that would break builds; P2: token-rotation no-op in the setup script).
- Completed: deployed to the VPS (pulled, rebuilt, restarted `mcat`+`mcat-demo`, verified healthy
  — localhost 200s, public HTTPS 401 basic-auth, error-capture pipeline confirmed alive via
  Sentry API). Found and discarded a stale, buggy uncommitted Sentry setup already live on the
  VPS from an Aug 11 session (same P1 bug, never triggered live). Found and fixed a second real
  bug the deploy surfaced: `SENTRY_RELEASE`/`NEXT_PUBLIC_SENTRY_RELEASE` were hardcoded/stale on
  the VPS, silently blocking every source-map upload since Aug 11 — removed them, confirmed via
  the Sentry API that auto-detected per-commit releases now upload correctly. Full narrative in
  `docs/session-archive.md`.
- Note: the local sandbox's `npm run build` failure (Google Fonts / Turbopack) is confirmed
  sandbox-only — the VPS build succeeds cleanly on the same code. Not a real product bug.
- Policy: received a Codex-delegation directive (quota conservation, until further notice) —
  route self-contained code-writing/review subtasks to Codex going forward; saved to auto memory.
- Reminder carried forward: `docs/tuning/proposal-2026-08-10.md` is **shelved, not pending** —
  do not apply, do not resume without asking. `docs/tuning/proposal-2026-08-11.md` is the
  successor and the one worth checking/applying.
- Next: user buys mcat.coach then DNS+cert; Aryan's section scores -> scored seed (may already
  be unblocked by the merged AAMC-import PR); 8 skill-audit flags; check whether
  `docs/tuning/proposal-2026-08-11.md` has been applied; unmerged worktree at mcat-view-state
  (`feat/persisted-view-state`, design doc only, unimplemented) still needs building.
