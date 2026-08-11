# Tuning loop + interfaces — five workstreams (approved 2026-08-10)

Global: vitest green + tsc clean + build green before commit; never commit `.env`, `data/`,
`resources/`, `.superpowers/`. This repo runs **Next.js 16.3.0** — read
`node_modules/next/dist/docs/` before writing framework-level code (see `AGENTS.md`); do not
rely on training-data knowledge of Next.js conventions.

## Why this wave exists

The nightly tuner runs on the Mac against local `data/mcat.db`. All real usage is on the VPS in
two separate databases. They have never met. Verified 2026-08-10:

| | local (what the tuner reads) | prod `mcat.db` | demo `demo.db` |
|---|---|---|---|
| results | 5 | 0 | 0 |
| episodes | 0 | 0 | 0 |
| transcripts | 0 | 32 | 30 |
| feedback | **0** | **4** | 0 |

`proposal-2026-08-10.md` was therefore built from 5 synthetic local attempts, and its UI/UX
section reads *"No UI/UX feedback recorded today"* while four real feedback items sat unread on
the VPS. WS-1 fixes the data path; WS-2/3 implement the two feature requests found in that
feedback; WS-4/5 build the missing bug channel that would have surfaced the one confirmed
production defect without anyone reading a transcript.

Note on `results = 0` in production: this is **not** a broken write path. Reading the prod
transcripts, no student ever answered a question to completion. Zero results is honest data.
Whether `record_result` persists correctly under real use remains **unverified** — do not treat
it as either working or broken.

---

## WS-1: Tuner on real data

Files: `scripts/pull-remote.sh` (new), `scripts/combine-db.ts` (new), `scripts/nightly-tune.ts`,
`lib/db.ts`, `package.json`, tests.

### 1.1 Pull

Both remote DBs are `journal_mode=wal` (verified). A plain `rsync` of a live `.db` can copy a
torn page set or miss commits still in the `-wal`. The pull therefore snapshots server-side with
SQLite's online backup API first:

```sh
ssh vps "cd /root/repos/mcat && sqlite3 data/mcat.db \".backup '/tmp/mcat-snap.db'\""
rsync vps:/tmp/mcat-snap.db data/remote/prod.db
ssh vps "rm -f /tmp/mcat-snap.db"
```

Same for `data/demo.db` → `data/remote/demo.db`. Snapshots land in `data/remote/` (gitignored).
The script must **never** write to local `data/mcat.db`.

Remote host is the `vps` ssh alias; app root `/root/repos/mcat`; pm2 apps `mcat` (port 3007) and
`mcat-demo` (port 3008), both cwd `/root/repos/mcat`, sharing one checkout with two DB files.

Failure of either pull aborts the run with a non-zero exit — a stale snapshot silently reused
would produce a confident proposal about yesterday.

### 1.2 Combine

`scripts/combine-db.ts` rebuilds `data/combined.db` from scratch on every run (delete + recreate;
never incremental, so a bad run cannot poison the next one).

- Every row-bearing table (`results`, `episodes`, `transcripts`, `feedback`, `tool_errors`) gains
  `source TEXT NOT NULL` ('prod' | 'demo') and `orig_id INTEGER NOT NULL`.
- Row ids are **reassigned** by autoincrement, not preserved — the two instances' id ranges
  overlap and merging them on id would silently collide. `(source, orig_id)` is the stable key.
- `categories` is copied from **prod only**. Mastery and `due_at` are per-instance student state;
  demo's values describe nobody.
- `chunks` is not copied (empty in both, and embeddings are not tuning input). `sessions` is
  copied with a `source` tag for completeness (empty in both today).
- `tool_errors` does not exist in the remote DBs until WS-4 ships. The combine must pragma-guard
  every source table and skip any that is absent, so WS-1 can land and run before WS-4.

### 1.3 Tune

`nightly-tune.ts` already honors `MCAT_DB` (`lib/db.ts:3`), so the job becomes
`pull → combine → MCAT_DB=data/combined.db tune`. Three changes inside it:

**Source filtering.** Instruction-tuning inputs (results, episodes, dialogue) filter to
`source='prod'`. Feedback and bugs draw from **both**. Rationale: the demo instance's transcripts
are largely ambient room audio — a bystander discussing surgical cases, "Have a good one, mom" —
which the bot answered as if it were a student. Tuning the examiner's conversational behavior on
that data would fit proposals to conversations no student had. Its *bugs* and *feedback*, by
contrast, are real.

All source filtering is guarded by a pragma check for the `source` column, following the existing
`due_at` pattern, so the tuner still runs against a plain local DB that has no `source` column.

**Date window: last 24 hours, not calendar `today`.** SQLite writes `datetime('now')` in UTC; the
Mac runs the job at 23:00 local, and the machine is US Central (CDT, UTC-5). So at job time the
local calendar day is already one behind UTC — 23:00 CDT on Aug 10 is 04:00 UTC on Aug 11. A
calendar-day query therefore asks for the wrong day *every single night*, not occasionally, and
would silently tune on a partial or empty slice. This is a latent bug in the tuner as it stands
today, independent of this wave. Use an explicit 24-hour lookback against UTC timestamps.

**Feedback write-back.** After the proposal is written, push
`UPDATE feedback SET status='proposed' WHERE id IN (…)` back to each remote DB over ssh, keyed on
`orig_id` per source. Without this, the combined DB is rebuilt nightly, `status` never persists,
and prod feedback #1–4 regenerates proposals every night forever. This is the only step in the
wave that **mutates production**: it must touch the `feedback.status` column and nothing else,
and must run only after the proposal file is successfully written.

### 1.4 Job wiring

`package.json` gains `pull` and `combine`. The launchd job
(`~/Library/LaunchAgents/com.mcat.tune.plist`, 23:00 daily) becomes `pull → combine → tune`, with
`touch ~/.cron-sentinels/mcat-tune` as the last line of the success path only — a failed pull must
leave the sentinel stale so the freshness monitor fires.

### 1.5 Tests

Combine against two `:memory:` fixture DBs: source tagging correct, id collisions between sources
resolved, `categories` taken from prod only, `(source, orig_id)` unique. Tuner: source filtering
with and without the `source` column present; 24h window boundary cases across a UTC/IST day
rollover. No live ssh and no live API calls in tests.

---

## WS-2: LaTeX + chemistry rendering

Files: `app/components/views/MathText.tsx` (new), the four view components, `app/layout.tsx`,
`lib/instructions.ts`, `package.json`, tests.

Driven by prod feedback #4 (2026-08-10 17:11): *"add markdown or latex … to handle chemical
formulas and equations for physics."*

**Renderer: KaTeX + the mhchem contrib extension**, self-hosted. Synchronous, so a view swap has
no layout flash; ~280KB with fonts; no CDN, which matters because the app sits behind basic auth
and an external dependency in the render path is a new failure mode. mhchem provides
`\ce{H2SO4 -> H+ + HSO4-}`, which plain KaTeX cannot express. MathJax is more complete but async
and heavier, and MCAT notation is not exotic.

*(OpenAI Prism was evaluated and rejected: it is a hosted LaTeX authoring workspace for writing
papers at prism.openai.com, not an embeddable renderer, library, or API. It cannot render math
inside this app.)*

**`MathText.tsx`** takes a string, splits on `$…$` and `$$…$$`, renders math segments via
`katex.renderToString`, and passes prose through untouched. Two settings carry the safety:

- `throwOnError: false` — malformed model output degrades to visible source rather than blanking
  the view. Model output is unreliable and a thrown render error would take out the whole panel.
- `trust: false` — blocks `\href`, `\htmlClass`, and friends, which would otherwise be an
  injection path through `dangerouslySetInnerHTML`.

**Applied in:** `FlashcardDeck` (front/back), `AnswerGrid` (options), `PassageView` (body),
`DataTable` (cells). **Not** the transcript: the transcript is a record of what was *spoken*, and
rendering notation there would mean displaying text the model never said.

**`lib/instructions.ts`** gains a NOTATION block: speak notation in words ("H two S O four"); write
LaTeX only inside `render_view` payloads; use `\ce{}` for chemistry. Without this the model emits
LaTeX into spoken text and TTS reads "backslash c e".

**Tests:** plain text passes through unchanged; inline and display math render; `\ce{}` renders;
malformed input degrades visibly instead of throwing; a `\href` payload does not produce an anchor
tag (trust posture).

---

## WS-3: Text input into the live session (Wave A)

Files: `lib/realtime-client.ts`, `app/page.tsx`, tests.

A text box is a **second input channel into the existing voice session**, not a separate engine.
The bot still replies with voice and still renders views.

`sendUserText(text)` emits `conversation.item.create` with a message item, role `user`, content
`[{type: 'input_text', text}]`, followed by `response.create`. This is the same path the
reconnect-resume already uses (`lib/realtime-client.ts:120`), so the event shape is proven in
production rather than assumed from the API docs.

UI: input plus Send in `app/page.tsx`, enabled only while connected, disabled with an explanatory
placeholder otherwise. Typed turns POST to `/api/transcript` as role `user` so they reach the
tuner's dialogue view — otherwise typed sessions would be invisible to WS-1.

**Tests stay pure**, consistent with the existing WS-B convention of no WebRTC mocking: a
`buildUserTextItem(text)` payload builder, plus validation (reject empty/whitespace-only, cap
length).

**Explicitly out of scope — Wave B:** a standalone text-only chat mode over the Responses API that
works with no mic and no audio. It gets its own design pass. Recorded here so a later session does
not mistake WS-3 for the whole chat feature.

---

## WS-4: Tool error tracking

Files: `app/api/tool/route.ts`, `lib/db.ts`, `lib/tools.ts`, `scripts/combine-db.ts`,
`scripts/nightly-tune.ts`, tests.

`app/api/tool/route.ts:23` currently returns `{error: message}` and drops it on the floor. That is
why the one confirmed production defect left no server-side trace and was discoverable only by
reading a transcript where the model narrated its own failure aloud.

**Log.** Add `console.error` carrying tool name, validation message, and the arg **keys** — never
arg values. Args carry question stems and `studentReasoning`, and pm2 logs are plaintext on the
VPS.

**Persist.** `tool_errors(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
tool TEXT NOT NULL, message TEXT NOT NULL, arg_keys TEXT)`, created with the same
`CREATE TABLE IF NOT EXISTS` + pragma-guard pattern as `episodes`. Written on every dispatch
failure.

**Feed the loop.** `tool_errors` joins the combine with its `source` tag and appears in a
`## Bugs` section of the nightly proposal, drawn from **prod + demo both**. Unlike dialogue, these
records contain no student content, so pooling across sources is safe. This is what makes demo's
promised contribution real: WS-1 says demo feeds bugs, but today there is no bug channel at all.

**Tests:** a dispatch failure writes exactly one row; arg *values* never appear in the persisted
record; absence of the table does not break `dispatchTool` against an older DB.

---

## WS-5: Sentry + daily error cycle

Files: Sentry instrumentation files (per installed Next 16 docs), `scripts/fetch-sentry.ts` (new),
`scripts/nightly-tune.ts`, `lib/briefing.ts`, `.env.example`, tests.

`tool_errors` covers tool dispatch only. Client-side crashes, realtime session failures, and API
routes returning 500 are still invisible.

**SDK:** `@sentry/nextjs`, DSN from env, **disabled whenever the DSN is unset** so local dev, tests,
and CI are unaffected. Instrumentation file layout follows `node_modules/next/dist/docs/` for the
installed Next 16.3.0 — not assumed from training data.

**Privacy.** There is no account system: prod is a single student behind basic auth, demo is
anonymous and public. No user identity is sent. Instead both instances report a coarse
`instance: prod|demo` tag, reusing the hostname logic already shipped in `eb689be`. Per the
house runbook: `sendDefaultPii: false`, no Session Replay, never email or full name. One
app-specific addition: **`beforeSend` strips request bodies** — `/api/tool` receives question stems
and `studentReasoning`, so a 500 on that route would otherwise ship a student's reasoning to
Sentry.

**Daily cycle.** `scripts/fetch-sentry.ts` queries the Sentry issues API (`is:unresolved`,
`statsPeriod=24h`) with `SENTRY_AUTH_TOKEN`. Not `sentry-cli` — it is not installed and would be a
heavy dependency for one HTTP call. Results merge with `tool_errors` into the single `## Bugs`
section of the nightly proposal; `lib/briefing.ts` names the top 2 in the morning briefing.

**Nothing is auto-fixed and nothing is auto-filed.** Consistent with the tuner's standing rule that
it proposes and a human applies.

**Degradation.** Missing token or unreachable Sentry writes "(Sentry unavailable)" into the
proposal and continues. It must not fail the run: the tune sentinel gates on success, and a Sentry
outage silently staling the freshness monitor is precisely the failure the sentinel exists to
catch.

**Tests:** issue-list parser against a fixture payload; missing-token path degrades without
throwing. No live API calls in tests.

**Manual step, owner: user.** Create the Sentry project and set `SENTRY_DSN` and
`SENTRY_AUTH_TOKEN` in `.env` locally and on the VPS. This cannot be done from the agent side.

---

## Scope addition: `data_table` row cap

`lib/views.ts:68` caps `data_table` at `.max(30)` rows. There are 34 categories, so the
curriculum-overview table can never render — the confirmed root cause of the "interface hiccup"
Aryan reported twice (prod feedback #3). Raise the cap to 60 and instruct the model to split by
section for anything larger.

---

## Verification

`npx vitest run`, `npx tsc --noEmit`, and a production build must all pass before commit.

Beyond the suite, WS-1 requires an **acceptance run against the real VPS**: execute
`pull → combine` and paste the actual row counts of `data/combined.db` by source. A green unit
suite proves the combine logic matches its fixtures; only the real run proves the fixtures match
the real databases.

## Deferred, deliberately

- **Wave B:** standalone no-mic chat mode over the Responses API (own design pass).
- **Autonomous Sentry fixing:** considered and declined; surface-only was chosen.
- `docs/tuning/proposal-2026-08-10.md`: **shelved, not pending.** Its 11 instruction-tuning
  proposals are over-fit to 5 synthetic local attempts (4A at 0% over 3 attempts). Do not apply
  them and do not resume them without asking. The first proposal worth acting on is the one
  generated *after* WS-1 lands and the tuner is reading real data.
