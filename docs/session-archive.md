### 2026-08-10 (part 1)
- Built the complete voice examiner from empty repo: Realtime voice + GPT-5.1 question brain, student model w/ episodic memory + spaced rep, PDF RAG, render_view UI, photo input, reconnect, briefing/tuner launchd jobs, Aryan landing page. 180+ tests, multi-agent build (Codex/cursor/opencode/devin + Claude).

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
  curriculum-overview failure Aryan hit twice); `/api/tool` swallows every tool error unlogged;
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
