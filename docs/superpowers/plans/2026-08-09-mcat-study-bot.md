# MCAT Study Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-run voice MCAT oral examiner: OpenAI Realtime API for conversation, a reasoning model for authoring hard questions, SQLite student model, RAG over the user's PDFs.

**Architecture:** Next.js App Router app. Browser ↔ Realtime API over WebRTC with an ephemeral token minted by a server route. The voice agent calls tools; the browser data-channel handler forwards each tool call to `/api/tool`, which dispatches to SQLite-backed functions and (for `generate_question`) a reasoning-model call. `show_content` renders on screen instead of hitting the server.

**Tech Stack:** Next.js 15 (App Router, TypeScript), better-sqlite3, zod, vitest, OpenAI REST via fetch (no SDK needed), `text-embedding-3-small` for RAG, reasoning model via `QUESTION_MODEL` env var.

## Global Constraints

- **API ground truth:** `docs/research/realtime-api-reference.md` (written by a research agent from live docs) OVERRIDES any endpoint, model name, event name, or payload shape in this plan. Before Tasks 6 and 8, read it and reconcile. The shapes in this plan follow the GA API as of early 2026 and are believed correct, but verify.
- Node 20+. Local only: never add deploy config; `.env` holds `OPENAI_API_KEY`, `QUESTION_MODEL` (default `gpt-5.1`), `REALTIME_MODEL` (default `gpt-realtime-2.1`, per research doc).
- `data/mcat.db`, `.env`, and `pdfs/` are gitignored. `data/taxonomy.json` IS committed.
- All server-only code under `lib/` and `scripts/`; nothing imports better-sqlite3 from client components.
- Tests: `npx vitest run <file>`. Commits after every green step, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer.
- Mastery granularity is the AAMC **content category** level (`4A`, `9B`, CARS skill categories). Topic strings within a category are prompt garnish, not tracked entities.

---

### Task 1: Scaffold app + test harness

**Files:**
- Create: Next.js scaffold at repo root, `vitest.config.ts`, `.env.example`, `.gitignore` additions, `tests/smoke.test.ts`

**Interfaces:**
- Produces: a bootable `npm run dev` app and a working `npx vitest run` harness all later tasks use.

- [ ] **Step 1: Scaffold** (repo already has `docs/`; scaffold into a temp dir and move contents, since create-next-app refuses non-empty dirs)

```bash
cd /path/to/mcat
npx create-next-app@latest _scaffold --ts --app --no-tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
rsync -a _scaffold/ ./ --exclude .git && rm -rf _scaffold
npm i better-sqlite3 zod && npm i -D vitest @types/better-sqlite3
```

- [ ] **Step 2: Config files**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

Append to `.gitignore`: `data/mcat.db`, `pdfs/`, `.env`

`.env.example`:
```
OPENAI_API_KEY=sk-...
QUESTION_MODEL=gpt-5.1
REALTIME_MODEL=gpt-realtime-2.1
```

`tests/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('harness runs', () => expect(1 + 1).toBe(2));
```

- [ ] **Step 3: Verify** — `npx vitest run` → 1 pass. `npm run build` → succeeds.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: scaffold Next.js app with vitest"`

---

### Task 2: Database layer + student model

**Files:**
- Create: `lib/db.ts`, `lib/student.ts`, `tests/student.test.ts`

**Interfaces:**
- Produces:
  - `openDb(path?: string): Database` — creates schema if missing (default `data/mcat.db`; tests pass `':memory:'`)
  - `seedTaxonomy(db, taxonomy: Taxonomy): void` — idempotent upsert of categories
  - `seedSectionScores(db, scores: Record<string, number>): void` — e.g. `{ chem_phys: 129, cars: 128, bio_biochem: 130, psych_soc: 129 }`; initializes mastery per category as `(score - 118) / 14`
  - `getProfile(db): Profile` — `{ categories: [{id, section, name, mastery, attempts, errorTypes: Record<string,number>}], lastSession: {mode, summary, focusNext} | null, weakest: string[] }` (weakest = 5 lowest-mastery ids with attempts-aware tiebreak: fewer attempts first)
  - `recordResult(db, r: { categoryId, difficulty: 1|2|3, correct: boolean, errorType?: 'content'|'reasoning'|'misread', mode, note?: string }): void` — EWMA update: `mastery = 0.75*mastery + 0.25*(correct ? 0.5 + difficulty/6 : (1 - difficulty/6) * 0.3)`
  - `writeSessionSummary(db, s: { mode, summary, focusNext }): void`
  - `Taxonomy` type: `{ sections: { id, name, categories: { id, name, topics: string[] }[] }[] }` (flattened view of taxonomy.json — foundational-concept nesting collapsed by the loader in Task 3)

- [ ] **Step 1: Schema in `lib/db.ts`**

```ts
import Database from 'better-sqlite3';
export function openDb(path = 'data/mcat.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories(
      id TEXT PRIMARY KEY, section TEXT NOT NULL, name TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      mastery REAL NOT NULL DEFAULT 0.5, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS results(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      category_id TEXT NOT NULL, difficulty INTEGER NOT NULL, correct INTEGER NOT NULL,
      error_type TEXT, mode TEXT NOT NULL, note TEXT);
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      mode TEXT NOT NULL, summary TEXT NOT NULL, focus_next TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks(
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, page INTEGER,
      text TEXT NOT NULL, embedding BLOB NOT NULL);
  `);
  return db;
}
```

- [ ] **Step 2: Failing tests in `tests/student.test.ts`** — cover: seed then `getProfile` returns all categories with seeded mastery; `recordResult` moves mastery up on correct hard / down on wrong easy and increments attempts; `weakest` orders by mastery; `writeSessionSummary` then `getProfile().lastSession` round-trips; `recordResult` with unknown categoryId throws. Use `openDb(':memory:')` and a 3-category fixture taxonomy defined inline in the test.

```ts
const tax = { sections: [{ id: 'chem_phys', name: 'CP', categories: [
  { id: '4A', name: 'Motion', topics: ['Kinematics'] },
  { id: '4B', name: 'Fluids', topics: ['Bernoulli'] },
  { id: '5A', name: 'Thermo', topics: ['Gibbs'] }]}]};
```

- [ ] **Step 3: Run** `npx vitest run tests/student.test.ts` → FAIL (functions missing)

- [ ] **Step 4: Implement `lib/student.ts`** per the Produces signatures. `errorTypes` aggregates `results.error_type` counts per category via `GROUP BY`. Clamp mastery to [0.02, 0.98].

- [ ] **Step 5: Run** → PASS

- [ ] **Step 6: Commit** — `feat: student model with EWMA mastery tracking`

---

### Task 3: Taxonomy loader + seed CLI

**Files:**
- Create: `lib/taxonomy.ts`, `scripts/seed.ts`, `tests/taxonomy.test.ts`
- Requires on disk: `data/taxonomy.json` (from research agent; if it doesn't exist yet, this task blocks — check first)

**Interfaces:**
- Consumes: `openDb`, `seedTaxonomy`, `seedSectionScores` from Task 2.
- Produces: `loadTaxonomy(path = 'data/taxonomy.json'): Taxonomy` — flattens the file's `sections[].foundational_concepts[].categories[]` nesting into `sections[].categories[]` (CARS's skill categories map the same way); validates with zod, throws on malformed input. `npm run seed -- --cp 129 --cars 128 --bb 130 --ps 129`.

- [ ] **Step 1: Failing test** — `loadTaxonomy` on a fixture file (write a minimal 2-section JSON to a temp path in the test) returns flattened categories; malformed JSON throws with a message naming the bad field.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `lib/taxonomy.ts` (zod schema mirroring the real `data/taxonomy.json` structure — open the real file and match it exactly; the research agent's structure wins over this plan's sketch) and `scripts/seed.ts` (parse argv flags, `openDb()`, `seedTaxonomy`, `seedSectionScores`, print category count). Add `"seed": "tsx scripts/seed.ts"` to package.json scripts; `npm i -D tsx`.
- [ ] **Step 4: Run tests** → PASS. Then run the real seed: `npm run seed -- --cp <user's> --cars <...> --bb <...> --ps <...>` (ask the user for their four section scores at execution time — do NOT invent them) and verify `sqlite3 data/mcat.db 'select count(*) from categories'` matches the taxonomy.
- [ ] **Step 5: Commit** — `feat: taxonomy loader and seed CLI`

---

### Task 4: PDF ingestion + RAG search

**Files:**
- Create: `lib/embeddings.ts`, `lib/rag.ts`, `scripts/ingest.ts`, `tests/rag.test.ts`

**Interfaces:**
- Consumes: `openDb` (chunks table).
- Produces:
  - `embed(texts: string[]): Promise<Float32Array[]>` — POST `https://api.openai.com/v1/embeddings`, model `text-embedding-3-small`, batches of ≤100
  - `chunkText(text: string, size = 1400, overlap = 200): string[]` — paragraph-aware: split on `\n\n`, pack paragraphs up to `size` chars, carry `overlap` tail chars forward
  - `searchMaterials(db, queryEmbedding: Float32Array, k = 5): { source, page, text, score }[]` — cosine over all chunks in JS (fine at <50k chunks)
  - `npm run ingest -- pdfs/*.pdf` — extracts text per page, chunks, embeds, inserts; skips a source already in `chunks` unless `--force`

- [ ] **Step 1: PDF text extraction** — use poppler's `pdftotext` via child_process (`pdftotext -layout -f N -l N file.pdf -` per page is slow; instead run once with page breaks: `pdftotext -layout file.pdf -` and split on `\f` to get pages). Check `pdftotext -v` exists; if not, tell the user `brew install poppler`.
- [ ] **Step 2: Failing tests** — `chunkText`: respects size, has overlap, never splits mid-paragraph unless a paragraph exceeds size; `cosine`/`searchMaterials`: insert 3 chunks with hand-built orthogonal embeddings (`[1,0,0]`, `[0,1,0]`, `[0,0,1]` as Float32Array→Buffer), query `[1,0,0]` returns the first with score ≈1. No API calls in tests.
- [ ] **Step 3: Run** → FAIL
- [ ] **Step 4: Implement** `lib/embeddings.ts`, `lib/rag.ts` (store `Buffer.from(f32.buffer)`, read back via `new Float32Array(buf.buffer, buf.byteOffset, buf.length/4)`), `scripts/ingest.ts`. Add `"ingest": "tsx scripts/ingest.ts"`.
- [ ] **Step 5: Run tests** → PASS
- [ ] **Step 6: Acceptance against real PDFs** — if the user has dropped PDFs in `pdfs/`, run the real ingest and a real search ("enzyme kinetics") and eyeball the top hits; if not, note in the commit message that real-PDF acceptance is pending and remind the user to add PDFs.
- [ ] **Step 7: Commit** — `feat: PDF ingestion and cosine RAG search`

---

### Task 5: Question generator (reasoning-model brain)

**Files:**
- Create: `lib/questions.ts`, `tests/questions.test.ts`, `scripts/smoke-question.ts`

**Interfaces:**
- Consumes: `searchMaterials`/`embed` (optional grounding), `Profile` shape from Task 2.
- Produces:
  - `QuestionSchema` (zod): `{ passage: string | null, stem: string, options: string[] (length 4), correctIndex: number, distractorRationales: string[] (length 4, index-aligned; entry at correctIndex explains why it's right), difficulty: 1|2|3, categoryId: string, explanation: string }`
  - `generateQuestion(params: { categoryId, categoryName, topics: string[], difficulty: 1|2|3, style: 'discrete'|'passage', groundingText?: string, avoidStems?: string[] }): Promise<Question>` — POST `https://api.openai.com/v1/chat/completions` with `model: process.env.QUESTION_MODEL`, `response_format: { type: 'json_schema', json_schema: { name: 'mcat_question', strict: true, schema: <zod-derived JSON schema> } }`; one retry on zod-parse failure

- [ ] **Step 1: Failing tests** — pure parts only: `QuestionSchema` rejects 3-option questions, rejects `correctIndex: 4`; `buildQuestionPrompt(params)` (exported) includes the category name, difficulty calibration language, and grounding text when provided. Do NOT mock the OpenAI call in unit tests.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.** System prompt core (tune wording freely, keep the substance):

```
You author MCAT questions for a student scoring 93rd percentile. Write at the
difficulty that discriminates 95th+ percentile: correct application of second-
order reasoning, plausible distractors that each encode a SPECIFIC common
misconception (name it in the rationale). Difficulty 1=AAMC medium, 2=AAMC
hard, 3=harder than AAMC (discrimination question). Passage style: 250-400
word novel experimental setup, journal register. Never reuse famous practice
questions. Ground in the provided source text when given.
```

- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Live smoke** (real API, per CLAUDE.md fixtures-vs-reality rule): `tsx scripts/smoke-question.ts` generates one difficulty-3 question for category 5A, zod-validates, prints it. Executor reads the output and confirms it is actually a coherent MCAT question (not just schema-valid).
- [ ] **Step 6: Commit** — `feat: reasoning-model question generator with strict schema`

---

### Task 6: Tool dispatcher + session-token routes

**Files:**
- Create: `app/api/tool/route.ts`, `app/api/session/route.ts`, `lib/tools.ts`, `lib/instructions.ts`, `tests/tools.test.ts`
- **Read first:** `docs/research/realtime-api-reference.md` — reconcile endpoint/payload shapes below.

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 5.
- Produces:
  - `dispatchTool(db, name: string, args: unknown): Promise<unknown>` in `lib/tools.ts` — handles `get_student_profile` (no args → Profile), `record_result` (zod-validated → `{ok:true, newMastery}`), `generate_question` (args `{categoryId, difficulty, style, useGrounding?: boolean}`; when `useGrounding`, embeds the category name+topics and passes top-3 chunk texts as `groundingText`), `search_materials` (`{query, k?}` → chunks), `end_session_summary` (`{mode, summary, focusNext}` → `{ok:true}`). Unknown tool → throws. **`show_content` is NOT here — it's client-side (Task 8).**
  - `POST /api/tool` body `{name, args}` → `{result}` or `{error: string}` with status 200 (the voice agent should receive errors as tool output, not HTTP failures)
  - `GET /api/session` → mints ephemeral token: POST `https://api.openai.com/v1/realtime/client_secrets` with `Authorization: Bearer OPENAI_API_KEY`, body `{ session: { type: 'realtime', model: REALTIME_MODEL, instructions: EXAMINER_INSTRUCTIONS, tools: TOOL_DEFS, audio: { output: { voice: 'marin' } } } }` → return `{ value, expires_at }` to the browser
  - `TOOL_DEFS`: realtime-format function definitions (`{type:'function', name, description, parameters}`) for the 5 server tools PLUS `show_content` (`parameters: { html: string, kind: 'passage'|'question'|'diagram'|'feedback' }`)
  - `EXAMINER_INSTRUCTIONS` in `lib/instructions.ts` (see Step 3)

- [ ] **Step 1: Failing tests** for `dispatchTool` with `:memory:` db (seed the 3-category fixture from Task 2): profile round-trip, record_result validation error surfaces as thrown ZodError, unknown tool throws. `generate_question`/`search_materials` paths are covered by Task 5's smoke + Task 9 acceptance, not unit-mocked.
- [ ] **Step 2: Run** → FAIL; implement; PASS.
- [ ] **Step 3: `EXAMINER_INSTRUCTIONS`** — the examiner persona. Substance to include (wording tunable):

```
You are a relentless but warm MCAT oral examiner. The student scores 93rd
percentile; your job is the last 4 points. SESSION START: call
get_student_profile, pick ONE mode — drill (weakest categories, escalate
difficulty on each correct, ask "why" after every answer), teach-back (student
explains a weak concept; interrupt imprecision, demand mechanism, pose edge
cases), or simulation (passage set via generate_question style=passage, timed
feel, full distractor post-mortem after). Announce the mode and why in one
sentence, then go. QUESTIONS: always fetch from generate_question — never
invent multiple-choice questions yourself. Read stems aloud; call show_content
to display passage text, answer options, and anything visual (structures,
equations, data tables) — never read those aloud. AFTER EVERY QUESTION: call
record_result with your judgment of error_type (content/reasoning/misread —
ask the student one diagnostic question if unsure which). Push pace; no
lecturing unless asked. END: when the student says they're done, call
end_session_summary with focus recommendations, then give a 30-second verbal
debrief. LATENCY: generate_question is slow (reasoning model); while waiting,
keep the student engaged with a short open-ended conceptual prompt from your
own knowledge (never invent multiple-choice). If any tool errors, say so in
one clause and continue from your own knowledge — never stall silently.
```

- [ ] **Step 4: Manual route check** — `npm run dev`, then `curl -s localhost:3000/api/session | jq .` → real `ek_...` value (this hits the real OpenAI API; confirms key + payload shape). `curl -s localhost:3000/api/tool -d '{"name":"get_student_profile","args":{}}' -H 'content-type: application/json' | jq .` → real seeded profile.
- [ ] **Step 5: Commit** — `feat: tool dispatcher, ephemeral session route, examiner instructions`

---

### Task 7: WebRTC realtime client

**Files:**
- Create: `lib/realtime-client.ts` (browser-side, framework-free), `tests/realtime-events.test.ts`
- **Read first:** `docs/research/realtime-api-reference.md` — event names and SDP endpoint are exactly the kind of thing that drifted during 2025.

**Interfaces:**
- Produces: `class RealtimeClient` with:
  - `connect(): Promise<void>` — `GET /api/session` → token; `new RTCPeerConnection()`; add mic track (`getUserMedia({audio:true})`); `ontrack` → attach remote stream to an `<audio>` element (constructor param); create data channel `'oai-events'`; SDP offer → `POST https://api.openai.com/v1/realtime/calls` (no `?model=` — model is baked into the ephemeral secret; the query-param form is the deprecated beta flow) with `Authorization: Bearer <ephemeral>`, `Content-Type: application/sdp` → setRemoteDescription(answer). Note: hard 60-minute session cap, no resume — reconnect mints a fresh token and re-seeds context via the profile.
  - `onEvent(handler: (e: ServerEvent) => void)` — raw parsed data-channel messages
  - `sendEvent(e: object)` — JSON over data channel
  - `disconnect()`
  - `handleServerEvent(e): Action | null` — **pure function** (exported separately for testing): maps `response.done` output items of `type: 'function_call'` → `{ kind: 'tool_call', callId, name, args }`; `conversation.item.input_audio_transcription.completed` → `{ kind: 'user_transcript', text }`; `response.output_audio_transcript.done` → `{ kind: 'bot_transcript', text }`; else null
  - `sendToolResult(callId: string, output: unknown)` — sends `{type:'conversation.item.create', item:{type:'function_call_output', call_id, output: JSON.stringify(output)}}` then `{type:'response.create'}`

- [ ] **Step 1: Failing tests** for `handleServerEvent` with fixture events. **Fixture rule (CLAUDE.md):** copy the fixture event JSON from `docs/research/realtime-api-reference.md`'s verbatim doc snippets — do not write fixtures from the implementation.
- [ ] **Step 2: Run** → FAIL; implement pure parts; PASS. (WebRTC plumbing itself is verified live in Task 9 — no jsdom theater.)
- [ ] **Step 3: Commit** — `feat: realtime WebRTC client with typed event handling`

---

### Task 8: UI

**Files:**
- Create: `app/page.tsx`, `app/components/ContentPanel.tsx`, `app/components/MasterySidebar.tsx`, `app/globals.css` edits
- Modify: none elsewhere.

**Interfaces:**
- Consumes: `RealtimeClient` (Task 7), `POST /api/tool` (Task 6).

Single-page layout, laptop-width (no mobile work — spec exception to the global mobile rule, user chose laptop-only; still avoid horizontal scroll):
- Header: Connect/Disconnect button, session mode badge (set from the first bot transcript), elapsed timer.
- Left ⅔: **ContentPanel** — renders `show_content` HTML via `dangerouslySetInnerHTML` after sanitizing with a strict allowlist (`p, ul, ol, li, table, tr, td, th, sub, sup, b, i, em, strong, br, h3, h4, code, pre` — no script/style/img/attrs). This is our own model's output on localhost, but sanitize anyway. `kind: 'question'` gets option letters styled as a list.
- Right ⅓: **MasterySidebar** — on connect and after every `record_result` tool round-trip, `POST /api/tool {name:'get_student_profile'}` and render the 5 weakest categories as name + mastery bar, plus running session tally (asked/correct).
- Bottom strip: rolling transcript (user + bot lines from transcript events).

Tool-call loop in `page.tsx`:
```ts
client.onEvent(async (e) => {
  const a = handleServerEvent(e);
  if (a?.kind === 'tool_call') {
    if (a.name === 'show_content') { setContent(a.args); client.sendToolResult(a.callId, { ok: true }); }
    else {
      const res = await fetch('/api/tool', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name: a.name, args: a.args }) }).then(r => r.json());
      client.sendToolResult(a.callId, res.error ? { error: res.error } : res.result);
      if (a.name === 'record_result' || a.name === 'get_student_profile') refreshSidebar();
    }
  }
  // transcript actions append to transcript state
});
```

- [ ] **Step 1: Implement** the three components. No new deps for sanitizing — write a 20-line DOMParser allowlist walker in `ContentPanel`.
- [ ] **Step 2: Verify** — `npm run build` passes; `npm run dev` renders the page, Connect button visible, sidebar shows seeded categories (via the profile fetch even before voice connect).
- [ ] **Step 3: Commit** — `feat: session UI with content panel and mastery sidebar`

---

### Task 9: End-to-end acceptance

**Files:**
- Create: `scripts/acceptance.ts`, `docs/superpowers/plans/acceptance-checklist.md`

- [ ] **Step 1: Scripted tool-loop acceptance** — `tsx scripts/acceptance.ts` against the running dev server: calls `/api/tool` in a realistic session sequence (profile → generate_question for weakest category → record_result wrong/content → generate_question same category difficulty+1 → record_result correct → search_materials → end_session_summary → profile again) and asserts: mastery moved in the right directions, question zod-validates, summary round-trips. Prints the generated question for human review. Run it; paste real output in the commit message body.
- [ ] **Step 2: Live voice checklist** (human-in-the-loop — write it, then DO it with the user):

```markdown
- [ ] Connect: mic permission prompt, bot greets and announces mode + reason
- [ ] Bot fetched profile (mode matches actual weakest areas)
- [ ] First question: stem read aloud, options appear on screen, NOT read aloud
- [ ] Answer wrong on purpose: bot probes error type, records, escalates follow-up
- [ ] Barge-in: interrupt bot mid-sentence, it stops and yields
- [ ] Teach-back: say "let me explain X" — bot interrupts an imprecise claim
- [ ] "I'm done": summary written (check sqlite sessions table), verbal debrief
- [ ] Reconnect works after killing the tab
```

- [ ] **Step 3: Fix what the checklist surfaces** (likely: instructions tuning — reading options aloud, forgetting record_result; fix in `lib/instructions.ts`, not code).
- [ ] **Step 4: Commit** — `test: acceptance script and live-session checklist` — then write a project `CLAUDE.md` (≤60 lines: run commands, env vars, the API-reference-wins rule, where the db lives) and commit.
