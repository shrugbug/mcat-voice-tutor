# Jarvis wave — six features, three workstreams (approved)

Global: no new runtime deps unless stated; vitest green + tsc clean + build green before commit; footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; never commit .env, data/, resources/, .superpowers/.

## WS-A: Episodic memory + spaced repetition (worktree A, branch feat/memory)

Files: lib/db.ts, lib/student.ts, lib/tools.ts, lib/instructions.ts is OFF-LIMITS (wave 2), tests.

1. Schema additions (CREATE IF NOT EXISTS, non-breaking):
   - `episodes(id, ts, category_id, stem TEXT, options_json TEXT, correct_index INT, chosen_index INT, error_type TEXT, misconception TEXT, student_reasoning TEXT, embedding BLOB NULL)`
   - `categories` gains `due_at TEXT NULL, interval_days REAL NOT NULL DEFAULT 1`.
2. lib/student.ts:
   - `recordEpisode(db, e)` — insert; embedding optional (filled by tool layer).
   - Spaced rep (SM-2-lite) inside recordResult: correct → interval_days = min(interval_days * 2, 8); wrong → interval_days = 1; due_at = now + interval_days. (Cap 8 days: exam in 2 weeks.)
   - `getDueCategories(db, limit=5)` — due_at <= now or NULL, ordered by mastery asc.
   - getProfile: add `due: string[]` (getDueCategories ids) and `recentMisconceptions: [{categoryId, misconception, ts}]` (last 10 episodes with non-null misconception).
3. lib/tools.ts:
   - New tool `record_episode` args {categoryId, stem, options: string[4], correctIndex, chosenIndex, errorType?, misconception?, studentReasoning?} → embeds stem+misconception (embed()), stores; returns {ok:true}.
   - New tool `recall_similar_mistakes` args {query, k<=5} → embeds query, cosine over episodes embeddings, returns [{stem, misconception, errorType, ts, categoryId}].
   - Both in TOOL_DEFS with descriptions telling the model: record_episode after every missed question (alongside record_result); recall_similar_mistakes when opening a topic.
4. Tests: schema round-trip, SM-2 interval math (correct doubling, wrong reset, cap), due ordering, recall with hand-built embeddings, dispatcher validation errors.

## WS-B: Session lifecycle — seamless reconnect (worktree B, branch feat/lifecycle)

Files: lib/realtime-client.ts, app/page.tsx, tests/realtime-*.

1. SKIPPED per user: no auto-connect on page load. Sessions start manually via the Connect button, always.
2. Drop detection → auto-reconnect: on pc connectionstate 'disconnected'/'failed'/'closed' while user hasn't clicked Disconnect, OR data channel close (60-min server cap): wait 1s, mint fresh token (GET /api/session), rebuild RTCPeerConnection, and resume: after channel open, send a conversation.item.create (message role user, input_text) saying "SYSTEM: session resumed after connection drop — call get_student_profile, recap where we were in one sentence, continue" then response.create. Max 3 attempts with backoff (1s/5s/15s), then surface manual Connect.
3. UI: status pill (connected / reconnecting… / disconnected), elapsed timer continues across reconnect (track cumulative), transcript preserved (client state — already survives).
4. Tests: pure logic only — extract reconnect decision (shouldReconnect(state, userInitiated, attempt)) and backoff schedule as pure functions with tests. No WebRTC mocking.

## WS-C: Ambient jobs — morning briefing + nightly tuner (worktree C, branch feat/ambient)

Files: scripts/briefing.ts, scripts/nightly-tune.ts, lib/briefing.ts, tests. Read-only against db (except tuner writing proposals to docs/). No app/ changes.

1. lib/briefing.ts: `buildBriefing(db, examDate: string)` → markdown: days-to-exam, 5 weakest + due categories (uses categories table directly; tolerate absence of due_at column — check pragma — so WS-C works standalone before WS-A merges), yesterday's session count + accuracy from results, top 2 recent misconceptions if episodes table exists, and a concrete 2-block study plan for today.
2. scripts/briefing.ts: builds briefing, writes docs/briefings/YYYY-MM-DD.md, sends macOS notification via `osascript -e 'display notification ... with title "MCAT Jarvis"'`, prints to stdout, then `touch ~/.cron-sentinels/mcat-briefing` (mkdir -p first) as last success line.
3. scripts/nightly-tune.ts: reads today's results+episodes; calls chat completions (QUESTION_MODEL, 60s timeout) with a prompt asking for instruction-tuning suggestions (too easy/hard? error_type misdiagnosis patterns? pacing?) based on the data; writes docs/tuning/proposal-YYYY-MM-DD.md with the model's proposals; NEVER edits lib/instructions.ts itself (human/controller applies proposals); macOS notification + `touch ~/.cron-sentinels/mcat-tune`.
4. package.json: "briefing" and "tune" scripts. EXAM_DATE from env or .env, default 2026-08-23.
5. Tests: buildBriefing on :memory: db fixtures (with and without due_at/episodes present); tuner prompt-builder pure function test. No live API calls in tests.
6. Do NOT install cron entries — controller does that after merge (with sentinels per house rules).

## Wave 2 (after A+B+C merge — controller dispatches)

- Photo-of-question ingestion (page upload → realtime image input; API shape verified first).
- lib/instructions.ts single unification pass: memory callbacks (record_episode/recall usage), tone-adaptation (detect frustration/fatigue from voice; shorten/switch modes; "you're rushing" interventions), photo flow, spaced-rep framing ("due today"), reconnect recap behavior.
- Cron installation with sentinels + freshness monitor note.
