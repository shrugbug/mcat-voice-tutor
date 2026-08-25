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

### 2026-08-24
- Completed: orientation only — no code changes. Verified: `main` clean/in-sync, 0 open
  issues/PRs, no Codex deferrals since 08-16. Both remote branches are behind main and their
  only unique content is docs: `feature/multi-user-launch` -> `docs/specs-multiuser/` (4 spec
  docs, not in main); `feat/persisted-view-state` (worktree `../mcat-view-state`) -> design doc
  only, still unimplemented. `docs/tuning/proposal-2026-08-11.md` NOT applied (0 keyword hits
  in `lib/instructions.ts`); local nightly-tune shows 0 attempts/day since 08-16 (local DB only,
  says nothing about VPS usage). `proposal-2026-08-10.md` remains **shelved, do not apply**.
- History rewrite (by control, Vishal's decision): all commits on main + both feature branches
  now authored by Shreya Sachdev <shreya.sachdev@gmail.com>; old history at tag
  `backup/pre-author-rewrite-2026-08-24`. Consequences: the VPS clone needs
  `git fetch && git reset --hard origin/main` on next deploy (non-fast-forward), and Sentry
  releases (SHA-derived) will restart under new IDs. Local git config is still Vishal — set
  `git config user.name/user.email` in this repo if future commits should match.
- Next: buy mcat.coach -> DNS + cert; Aryan's section scores -> scored seed; 8 skill-audit
  flags; decide/apply `proposal-2026-08-11.md`; build `feat/persisted-view-state`; decide
  whether to merge `docs/specs-multiuser/` into main.
