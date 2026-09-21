### 2026-08-10 (part 1)
- Built the complete voice examiner from empty repo: Realtime voice + GPT-5.1 question brain, student model w/ episodic memory + spaced rep, PDF RAG, render_view UI, photo input, reconnect, briefing/tuner launchd jobs, personalized landing page. 180+ tests, multi-agent build (Codex/cursor/opencode/devin + Claude).

### 2026-08-10 (part 2)
- Completed: dogfooded full UI (fixed table overflow affordance + passage tables + app title; /debug/views harness); transcript + UI/UX-feedback capture feeding nightly tuner; deployed to VPS (mcat.illinihunt.org, basic auth, rotated); domain shortlist checked (mcat.coach chosen, user checkout pending); OSS-voice research (verdict: keep Realtime API); skills library unhobbled (37 trimmed, 8 flagged); multi-user launch spec suite + pricing on feature/multi-user-launch.
- Completed (later): isolated public demo at mcatdemo.illinihunt.org (own db/auth/rate-zone, hostname-based generic greeting).
- Note: most of that entry's "Next" items (multi-user-launch specs, licensing analysis, AAMC score import) were resolved by other agent sessions on 2026-08-11 via PRs #1-#7 (see git log) — but those commits sat unpulled into this local checkout until at least 2026-08-16.

### 2026-08-10 (part 3)
- Verified the Jarvis wave (WS-A/B/C + wave 2) is fully shipped on main: episodes + spaced rep,
  reconnect, briefing/tuner, photo input, unified instructions, launchd jobs w/ sentinels.
- Key finding: the nightly tuner reads LOCAL `data/mcat.db` (5 synthetic results) while all real
  usage sits in two VPS databases (prod: 32 transcripts + 4 feedback; demo: 30 transcripts). They
  have never met — so `proposal-2026-08-10.md` was built on synthetic data and its UI/UX section
  says "no feedback today" while four real items sat unread on the VPS.
- Also found: `data_table` caps at 30 rows vs 34 categories (confirmed root cause of the
  curriculum-overview failure the student hit twice); `/api/tool` swallows every tool error unlogged;
  the demo mic is capturing bystander room audio into a public db.
- Specced the fix — 5 workstreams on `feat/tuning-loop-and-interfaces` (pushed, no PR yet):
  `docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md`. Approved, not yet
  implemented. Worktree at `../mcat-tuning-loop`.
- DECLINED: `docs/tuning/proposal-2026-08-10.md` is **shelved, not pending** — over-fit to 5
  synthetic attempts. Do not apply; do not resume without asking. The first proposal worth acting
  on is the one generated after WS-1 lands.
- Next (superseded — see 2026-08-16 note above): all 5 workstreams (WS-1 through WS-5b, including
  Sentry issue-fetch) shipped in PRs #1-#7 on 2026-08-11. `docs/tuning/proposal-2026-08-11.md` is
  the successor proposal generated after WS-1 landed — check whether it's been applied before
  resuming `docs/tuning/proposal-2026-08-10.md`, which remains shelved.

### 2026-08-16
- Completed: read-only research session documenting the Realtime-voice implementation
  (provider/transport/architecture/mobile-support-status/config/cost/reuse) for porting to a
  separate web-embedded voice-agent MVP.
- Completed: pulled the 7 commits this checkout was missing (PRs #1-#7 from 2026-08-11) and
  merged cleanly, resolving a real conflict in `CLAUDE.md`/`docs/session-archive.md` (two
  divergent session logs — archived correctly, preserved the shelved-proposal warning above).
- Completed: reconciled pre-existing uncommitted local Sentry work against what PR #7 had
  already shipped. Kept PR #7's tested, PII-scrubbed `instrumentation.ts`/`instrumentation-client.ts`
  as-is; added only what was missing — `next.config.ts` wrapped with `withSentryConfig`
  (build-time source-map/release upload via a new `SENTRY_CI_TOKEN`, separate from the nightly
  reader's `SENTRY_AUTH_TOKEN`), `app/global-error.tsx`, `SENTRY-VPS-SETUP.sh`.
- Completed: codex review of that reconciliation caught two real bugs, both fixed — (P1)
  `next.config.ts` fell back to the read-only `SENTRY_AUTH_TOKEN` when `SENTRY_CI_TOKEN` was
  unset, which would have thrown on every build once both vars existed (they now do) instead of
  no-opping as intended; (P2) `SENTRY-VPS-SETUP.sh`'s `append_if_missing` silently no-op'd token
  rotation on an already-configured `.env`, reporting success regardless.
- Completed: deployed to the VPS. Found it already had `SENTRY_CI_TOKEN` provisioned (an Aug 11
  session had deployed the same pattern there directly, uncommitted, with the same P1 bug —
  never triggered live since the token was always present) — discarded those uncommitted edits,
  pulled the reviewed commits, rebuilt, restarted `mcat` + `mcat-demo`. Verified: both `online`,
  `200` on localhost, `401` (correct basic-auth) on the public HTTPS domain, error-capture
  pipeline confirmed alive via a prior smoke-test event visible in the Sentry API.
- Completed: found and fixed a real bug the deploy verification surfaced — `SENTRY_RELEASE`/
  `NEXT_PUBLIC_SENTRY_RELEASE` were hardcoded on the VPS to a stale value (`mcat-666536b`, from
  the Aug 11 ad-hoc setup), overriding the Sentry build plugin's per-commit auto-detection, so
  every build deduped against that stale release and no new source-map upload ever registered.
  Removed the pinned vars (backed up `.env` first), rebuilt, confirmed via the Sentry API that a
  new release now uploads correctly under the current commit SHA.
- Note: the local sandbox's `npm run build` failure (Google-Fonts-under-Turbopack) is confirmed
  sandbox-only — the VPS build succeeded cleanly with the same code. Not a real product bug.
- Policy: received a Codex-delegation directive via Control broadcast (quota conservation) —
  saved to auto memory (`feedback-delegate-code-to-codex.md`). Route self-contained
  code-writing/review subtasks to Codex going forward, until further notice.

### 2026-08-24
- Completed: orientation only — no code changes. Verified: `main` clean/in-sync, 0 open
  issues/PRs, no Codex deferrals since 08-16. Both remote branches are behind main and their
  only unique content is docs: `feature/multi-user-launch` -> `docs/specs-multiuser/` (4 spec
  docs, not in main); `feat/persisted-view-state` (worktree `../mcat-view-state`) -> design doc
  only, still unimplemented. `docs/tuning/proposal-2026-08-11.md` NOT applied (0 keyword hits
  in `lib/instructions.ts`); local nightly-tune shows 0 attempts/day since 08-16 (local DB only,
  says nothing about VPS usage). `proposal-2026-08-10.md` remains **shelved, do not apply**.
- History rewrite: all commits on main + both feature branches
  now authored by Shreya Sachdev <shreya.sachdev@gmail.com>; old history at tag
  `backup/pre-author-rewrite-2026-08-24`. Consequences: the VPS clone needs
  `git fetch && git reset --hard origin/main` on next deploy (non-fast-forward), and Sentry
  releases (SHA-derived) will restart under new IDs.
- Next: buy mcat.coach -> DNS + cert; the student's section scores -> scored seed; 8 skill-audit
  flags; decide/apply `proposal-2026-08-11.md`; build `feat/persisted-view-state`; decide
  whether to merge `docs/specs-multiuser/` into main.

### 2026-09-02
- Completed: repo transferred to `shrugbug/mcat` (local + VPS remotes repointed). Auto-deploy: `.github/workflows/deploy.yml` runs on
  every push to `main`, SSHes as `deployer` with a forced-command key that can only run
  `/usr/local/bin/mcat-deploy` (fetch, reset to origin/main, install, build, pm2 restart,
  health check, `/var/log/mcat-deploy.log`). Verified on three pushes; one runner-side SSH
  timeout led to a 3x connect retry in the workflow. Secrets survived the transfer. Linux user
  `shreya` (sudo limited to mcat-deploy + mcat pm2 cmds) has a key installed, untested. VPS moved off the pre-rewrite SHA, closing the `reset --hard` item. Runbook
  corrected: demo has had basic auth since 08-10.
- Declined for now: a staging instance for branch previews (second checkout, port 3009,
  nginx vhost + cert, manual-dispatch workflow). Local experimentation uses a separate OpenAI
  key. Revisit if a shared preview URL is needed.
- Next: mcat.coach DNS + cert; the student's scores -> scored seed; 8 skill-audit flags; decide
  `proposal-2026-08-11.md`; build `feat/persisted-view-state` (19 commits behind main);
  `docs/specs-multiuser/`. Main is unprotected and every push rebuilds prod: consider a
  build check on PRs.
