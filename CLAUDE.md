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

## Deployment

VPS (`ssh vps`, `/root/repos/mcat`, pm2 apps `mcat` + `mcat-demo`). Every push to `main` auto-deploys via
`.github/workflows/deploy.yml`; manual fallback `ssh vps mcat-deploy`.
Details and deploy-user setup: `docs/operations.md` section 1.

## Session Log

### 2026-09-04
- Completed: orientation only — no code changes, nothing to commit. Resolved Shreya's question
  about the `mcat.illinihunt.org` (prod) basic-auth password: found on VPS at
  `/root/repos/mcat/the prod credentials file` (user `aryan`), confirmed live with a `401` on
  the public URL. Shreya cannot read this herself — her sudo grant has no `/root` shell access,
  only `mcat-deploy` + mcat pm2 commands. `docs/operations.md` §1 documents where the *demo*
  credentials live (`DEMO_CREDENTIALS.txt`) but never mentions `the prod credentials file` for
  prod; offered to add that line, not yet done pending Vishal's go-ahead. `feat/persisted-view-state`
  worktree still clean/unimplemented, now 20 commits behind main (was 19 on 09-02). No open
  GitHub issues/PRs. No Codex activity on this repo since 09-02.
- Next: decide whether to (a) document `the prod credentials file` in `docs/operations.md`,
  (b) hand Shreya the prod password directly since she has no path to read it herself; send
  `docs/drafts/2026-09-02-shreya-vps-access.txt` if still unsent; mcat.coach DNS + cert; Aryan's
  scores -> scored seed; 8 skill-audit flags; decide `proposal-2026-08-11.md`; build
  `feat/persisted-view-state` (20 behind main — rebase before starting); `docs/specs-multiuser/`.
  Main is unprotected and every push rebuilds prod: consider a build check on PRs.
