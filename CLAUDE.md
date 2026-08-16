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
- Completed: read-only research session documenting the Realtime-voice implementation (provider/transport/architecture/mobile-support-status/config/cost/reuse) for porting to a separate web-embedded voice-agent MVP.
- Completed: pulled the 7 commits this checkout was missing (PRs #1-#7 from 2026-08-11 sessions — tuning-loop spec, AAMC score import, hotfix, tuner VPS data + Sentry issue fetch, ops runbook, corpus licensing analysis, LaTeX/tool-error/Sentry) and merged cleanly.
- Completed: reconciled the pre-existing uncommitted local Sentry work against what PR #7 had already shipped. PR #7's `instrumentation.ts`/`instrumentation-client.ts` already had PII scrubbing (`lib/sentry-scrub.ts`) and prod/demo instance tagging, tested — kept those as-is rather than overwriting with the older, unscrubbed local draft. Added only the genuinely missing pieces: `next.config.ts` wrapped with `withSentryConfig` for build-time source-map/release upload (using a new `SENTRY_CI_TOKEN`, separate from the nightly reader's `SENTRY_AUTH_TOKEN`), `app/global-error.tsx` root error boundary, and `SENTRY-VPS-SETUP.sh` for setting the new token on the VPS. 318 tests + typecheck pass; `npm run build` hits a pre-existing Google-Fonts-under-Turbopack failure unrelated to this change (verified by isolating: fails identically with `next.config.ts` reverted to the unwrapped PR #7 version) — not caused by this session, not yet root-caused.
- Reminder carried forward from the pulled history: `docs/tuning/proposal-2026-08-10.md` is **shelved, not pending** — over-fit to 5 synthetic attempts, do not apply, do not resume without asking. `docs/tuning/proposal-2026-08-11.md` is the successor generated after WS-1 landed and is the one worth checking/applying.
- Next: run `SENTRY-VPS-SETUP.sh` to set `SENTRY_CI_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` on the VPS, then rebuild+restart so source-map upload takes effect; root-cause the pre-existing `npm run build` Turbopack/Google-Fonts failure (blocks local production builds, VPS build path not yet re-verified after the merge); user buys mcat.coach then DNS+cert; Aryan's section scores -> scored seed (may already be unblocked by the merged AAMC-import PR); 8 skill-audit flags; check whether `docs/tuning/proposal-2026-08-11.md` has been applied; unmerged worktree at mcat-view-state (`feat/persisted-view-state`, design doc only, unimplemented) still needs building.
