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
- Completed: read-only research session. Documented the Realtime-voice implementation (provider/transport/architecture/mobile-support-status/config/cost/reuse) for porting to a separate web-embedded voice-agent MVP; no code changed.
- Discovery: this local checkout was **7 commits behind origin/main** — PRs #1-#7 merged by other agent sessions on 2026-08-11 (tuning-loop spec, AAMC score import, hotfix, tuner VPS data + Sentry issue fetch, ops runbook, corpus licensing analysis, and LaTeX/tool-error/Sentry work) had never been pulled here. Now pulled and merged. There's also pre-existing uncommitted local work (from an Aug 11 session, left uncommitted): `@sentry/nextjs` app instrumentation (`next.config.ts`, `instrumentation*.ts`, `sentry.*.config.ts`, `app/global-error.tsx`, `SENTRY-VPS-SETUP.sh`) — source-map upload build hook and VPS DSN/rebuild/restart still pending per that session's own notes. Being reconciled against the pulled `main` now.
- Reminder carried forward from the pulled history: `docs/tuning/proposal-2026-08-10.md` is **shelved, not pending** — over-fit to 5 synthetic attempts, do not apply, do not resume without asking. `docs/tuning/proposal-2026-08-11.md` is the successor generated after WS-1 landed and is the one worth checking/applying.
- Next: finish reconciling the uncommitted Sentry instrumentation against pulled `main` (add DSN on VPS, rebuild, restart, wire source-map upload); user buys mcat.coach then DNS+cert; Aryan's section scores -> scored seed (may already be unblocked by the merged AAMC-import PR); 8 skill-audit flags; check whether `docs/tuning/proposal-2026-08-11.md` has been applied; unmerged worktree at mcat-view-state (`feat/persisted-view-state`, design doc only, unimplemented) still needs building.
