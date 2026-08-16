### 2026-08-10 (part 1)
- Built the complete voice examiner from empty repo: Realtime voice + GPT-5.1 question brain, student model w/ episodic memory + spaced rep, PDF RAG, render_view UI, photo input, reconnect, briefing/tuner launchd jobs, Aryan landing page. 180+ tests, multi-agent build (Codex/cursor/opencode/devin + Claude).

### 2026-08-10 (part 2)
- Completed: dogfooded full UI (fixed table overflow affordance + passage tables + app title; /debug/views harness); transcript + UI/UX-feedback capture feeding nightly tuner; deployed to VPS (mcat.illinihunt.org, basic auth, rotated); domain shortlist checked (mcat.coach chosen, user checkout pending); OSS-voice research (verdict: keep Realtime API); skills library unhobbled (37 trimmed, 8 flagged); multi-user launch spec suite + pricing on feature/multi-user-launch.
- Completed (later): isolated public demo at mcatdemo.illinihunt.org (own db/auth/rate-zone, hostname-based generic greeting).
- Note: most of that entry's "Next" items (multi-user-launch specs, licensing analysis, AAMC score import) were resolved by other agent sessions on 2026-08-11 via PRs #1-#7 (see git log) — but those commits sat unpulled into this local checkout until at least 2026-08-16.
