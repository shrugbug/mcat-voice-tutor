# Tuning Loop + Interfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the nightly tuner at the real VPS data it has never read, and ship the four feature/observability changes that data asked for.

**Architecture:** Five independent workstreams from `docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md`. Each task ends at a committable, independently testable deliverable. Tasks are ordered so the cheapest confirmed-bug fixes land first and the tuner data path lands before anything that feeds it.

**Tech Stack:** Next.js 16.3.0 (App Router), React 19.2, TypeScript, better-sqlite3, zod 4, vitest, KaTeX, `@sentry/nextjs`.

## Global Constraints

- **Next.js 16.3.0 is not the Next.js in your training data.** Read `node_modules/next/dist/docs/` before writing any framework-level code (instrumentation files, route conventions, config). See `AGENTS.md`.
- Every task must leave `npx vitest run`, `npx tsc --noEmit`, and `npm run build` green before its commit.
- Never commit `.env`, `data/`, `resources/`, `.superpowers/`, or `data/remote/`.
- Work in the worktree `/path/to/mcat-tuning-loop` on branch `feat/tuning-loop-impl`. The main checkout `/path/to/mcat` is shared with another live agent — never run branch-mutating git commands there.
- `node_modules` in the worktree must be a real install, not a symlink. Turbopack rejects a symlinked `node_modules` with `Symlink [project]/node_modules is invalid, it points out of the filesystem root`.
- Commit footer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- New schema additions use `CREATE TABLE IF NOT EXISTS` plus a `PRAGMA table_info` guard for added columns, following the existing `due_at` pattern in `lib/db.ts:41-46`.
- Read-only queries against the combined database must tolerate a missing `source` column so the tuner still runs against a plain local db.

---

### Task 1: Raise the `data_table` row cap

The confirmed root cause of the curriculum-overview failure: the schema caps at 30 rows, and there are 34 categories, so that table can never render. Reported twice in production feedback.

**Files:**
- Modify: `lib/views.ts:68`
- Modify: `lib/instructions.ts` (DISPLAY paragraph)
- Test: `tests/views.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `data_table` accepts up to 60 rows. No signature change.

- [ ] **Step 1: Write the failing test**

Add to `tests/views.test.ts`:

```typescript
describe('data_table row cap', () => {
  const table = (rowCount: number) => ({
    component: 'data_table' as const,
    headers: ['Category', 'Mastery'],
    rows: Array.from({ length: rowCount }, (_, i) => [`cat-${i}`, '0.50']),
  });

  test('accepts a row per taxonomy category (34) — the curriculum overview case', () => {
    expect(ViewSpecSchema.safeParse(table(34)).success).toBe(true);
  });

  test('accepts up to 60 rows', () => {
    expect(ViewSpecSchema.safeParse(table(60)).success).toBe(true);
  });

  test('still rejects an unbounded table', () => {
    expect(ViewSpecSchema.safeParse(table(61)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/views.test.ts -t "data_table row cap"`
Expected: FAIL — the 34-row and 60-row cases return `success: false` against the current `.max(30)`.

- [ ] **Step 3: Raise the cap**

In `lib/views.ts`, change the `rows` line of `dataTableSchema`:

```typescript
    rows: z.array(z.array(z.string())).max(60),
```

- [ ] **Step 4: Tell the model to split oversized tables**

In `lib/instructions.ts`, in the DISPLAY paragraph, immediately after the sentence beginning `Use timer for timed passages,`, insert:

```
A data_table holds at most 60 rows; if you have more, split it into one table per section rather than truncating it.
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/views.test.ts`
Expected: PASS

- [ ] **Step 6: Verify the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors

- [ ] **Step 7: Commit**

```bash
git add lib/views.ts lib/instructions.ts tests/views.test.ts
git commit -m "fix: raise data_table cap to 60 rows

34 categories against a 30-row cap meant the curriculum-overview table
could never render. Reported twice in production feedback; the model
degraded to a spoken overview and narrated the failure aloud.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tool error tracking (WS-4)

`app/api/tool/route.ts:23` returns `{error}` and drops it, which is why the Task 1 bug left no server-side trace.

**Files:**
- Modify: `lib/db.ts` (schema)
- Create: `lib/tool-errors.ts`
- Modify: `app/api/tool/route.ts`
- Test: `tests/tool-errors.test.ts`

**Interfaces:**
- Consumes: `openDb` from `lib/db`
- Produces: `recordToolError(db: DB, tool: string, message: string, args: unknown): void` and `argKeys(args: unknown): string` from `lib/tool-errors`. Table `tool_errors(id, ts, tool, message, arg_keys)`.

- [ ] **Step 1: Write the failing test**

Create `tests/tool-errors.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import { argKeys, recordToolError } from '../lib/tool-errors';

describe('argKeys', () => {
  test('returns only key names, never values', () => {
    // Args carry question stems and studentReasoning; pm2 logs are plaintext on the VPS.
    const keys = argKeys({ categoryId: '4A', stem: 'A frog jumps...', studentReasoning: 'I guessed' });
    expect(keys).toBe('categoryId,stem,studentReasoning');
    expect(keys).not.toContain('frog');
    expect(keys).not.toContain('guessed');
  });

  test('handles non-object args without throwing', () => {
    expect(argKeys(null)).toBe('');
    expect(argKeys('a string')).toBe('');
    expect(argKeys([1, 2])).toBe('');
  });
});

describe('recordToolError', () => {
  test('writes exactly one row carrying no arg values', () => {
    const db = openDb(':memory:');
    recordToolError(db, 'render_view', 'Too many rows', { rows: ['secret'] });

    const rows = db.prepare('SELECT tool, message, arg_keys FROM tool_errors').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: 'render_view', message: 'Too many rows', arg_keys: 'rows' });
    expect(JSON.stringify(rows[0])).not.toContain('secret');
    db.close();
  });

  test('does not throw when the table is absent (older db)', () => {
    const bare = new Database(':memory:') as unknown as Parameters<typeof recordToolError>[0];
    expect(() => recordToolError(bare, 'x', 'y', {})).not.toThrow();
    (bare as unknown as Database.Database).close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tool-errors.test.ts`
Expected: FAIL — `Cannot find module '../lib/tool-errors'`

- [ ] **Step 3: Add the schema**

In `lib/db.ts`, inside the `db.exec()` template literal, after the `results` table definition, add:

```sql
    CREATE TABLE IF NOT EXISTS tool_errors(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      tool TEXT NOT NULL, message TEXT NOT NULL, arg_keys TEXT);
```

- [ ] **Step 4: Write the module**

Create `lib/tool-errors.ts`:

```typescript
import type { DB } from './db';

/**
 * Key names only -- never values. Tool args carry question stems and studentReasoning, and pm2
 * logs are plaintext on the VPS.
 */
export function argKeys(args: unknown): string {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return '';
  return Object.keys(args as Record<string, unknown>).join(',');
}

/**
 * Best-effort persistence of a tool dispatch failure. Never throws: a logging failure must not
 * turn a handled tool error into an unhandled request error.
 */
export function recordToolError(db: DB, tool: string, message: string, args: unknown): void {
  try {
    db.prepare('INSERT INTO tool_errors (tool, message, arg_keys) VALUES (?, ?, ?)').run(
      tool,
      message,
      argKeys(args)
    );
  } catch {
    // Table absent on an older db, or the db is read-only. Nothing to do.
  }
}
```

If `lib/db.ts` does not already export a `DB` type, import the type the way `scripts/nightly-tune.ts:5` does (`import { openDb, type DB } from '../lib/db'`) — it exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tool-errors.test.ts`
Expected: PASS

- [ ] **Step 6: Wire it into the route**

Rewrite `app/api/tool/route.ts` so failures are logged and persisted. Note the db must be opened before the catch can use it, so restructure:

```typescript
import { z } from 'zod';
import { openDb } from '@/lib/db';
import { dispatchTool } from '@/lib/tools';
import { argKeys, recordToolError } from '@/lib/tool-errors';

export const dynamic = 'force-dynamic';

const requestSchema = z.strictObject({
  name: z.string(),
  args: z.unknown(),
});

export async function POST(request: Request): Promise<Response> {
  let name = 'unknown';
  let args: unknown = null;

  try {
    ({ name, args } = requestSchema.parse(await request.json()));
    const db = openDb();

    try {
      return Response.json({ result: await dispatchTool(db, name, args) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown tool error';
      console.error(`[tool] ${name} failed: ${message} (args: ${argKeys(args)})`);
      recordToolError(db, name, message, args);
      return Response.json({ error: message });
    } finally {
      db.close();
    }
  } catch (error) {
    // Malformed request body: no db handle, so log only.
    const message = error instanceof Error ? error.message : 'Unknown tool error';
    console.error(`[tool] ${name} request rejected: ${message}`);
    return Response.json({ error: message });
  }
}
```

- [ ] **Step 7: Verify end-to-end against a real failure**

Run: `npm run dev` in one shell, then in another:

```bash
curl -s -X POST http://localhost:3000/api/tool \
  -H 'Content-Type: application/json' \
  -d '{"name":"render_view","args":{"view":{"component":"data_table","headers":["a"],"rows":[]}}}'
```

Expected: a JSON `{error: ...}` response, a `[tool] render_view failed:` line in the dev server output, and one new row in `tool_errors`. Confirm with:

```bash
sqlite3 data/mcat.db "SELECT tool, message, arg_keys FROM tool_errors ORDER BY id DESC LIMIT 1"
```

Stop the dev server afterward.

- [ ] **Step 8: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green

- [ ] **Step 9: Commit**

```bash
git add lib/db.ts lib/tool-errors.ts app/api/tool/route.ts tests/tool-errors.test.ts
git commit -m "feat: log and persist tool dispatch failures

The route swallowed every tool error, so the one confirmed production
defect was discoverable only by reading a transcript where the model
narrated its own failure aloud. Records arg keys only -- args carry
question stems and studentReasoning.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: WAL-safe pull of both remote databases (WS-1.1)

**Files:**
- Create: `scripts/pull-remote.sh`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: ssh alias `vps`, remote app root `/root/repos/mcat`
- Produces: `data/remote/prod.db` and `data/remote/demo.db`. `npm run pull`.

- [ ] **Step 1: Write the script**

Create `scripts/pull-remote.sh`:

```bash
#!/usr/bin/env bash
# Pulls both production databases from the VPS for offline tuning.
#
# Both remote dbs are journal_mode=wal. A plain rsync of a live .db can copy a torn page set or
# miss commits still sitting in the -wal, so each is snapshotted server-side with SQLite's online
# backup API first, then transferred.
set -euo pipefail

HOST="${MCAT_VPS_HOST:-vps}"
APP_DIR="/root/repos/mcat"
DEST="data/remote"

mkdir -p "$DEST"

pull_one() {
  local remote_name="$1" local_name="$2" tmp="/tmp/mcat-pull-$$-$2"

  echo "Pulling ${remote_name} -> ${DEST}/${local_name}"
  ssh "$HOST" "cd ${APP_DIR} && sqlite3 data/${remote_name} \".backup '${tmp}'\""
  rsync -q "${HOST}:${tmp}" "${DEST}/${local_name}"
  ssh "$HOST" "rm -f ${tmp}"
}

pull_one "mcat.db" "prod.db"
pull_one "demo.db" "demo.db"

for f in prod demo; do
  count=$(sqlite3 "${DEST}/${f}.db" "SELECT COUNT(*) FROM categories")
  echo "  ${f}.db: ${count} categories"
  if [ "$count" -eq 0 ]; then
    echo "ERROR: ${f}.db has no categories -- refusing a snapshot that would tune on nothing." >&2
    exit 1
  fi
done

echo "Pull complete."
```

Make it executable: `chmod +x scripts/pull-remote.sh`

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
    "pull": "bash scripts/pull-remote.sh",
```

- [ ] **Step 3: Run it against the real VPS**

Run: `npm run pull`
Expected: both files appear under `data/remote/`, each reporting 34 categories. This is the acceptance test — a unit test cannot prove the ssh/backup path works.

- [ ] **Step 4: Verify snapshots are ignored by git**

Run: `git status --short`
Expected: `data/remote/` does NOT appear (it is already in `.gitignore` from the exam-import work). If it does appear, stop and add it — these files contain real student data.

- [ ] **Step 5: Commit**

```bash
git add scripts/pull-remote.sh package.json
git commit -m "feat: WAL-safe pull of both VPS databases

Snapshots server-side with sqlite3 .backup before transfer: both remote
dbs are journal_mode=wal, where a plain rsync can copy a torn page set
or miss commits still in the -wal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Source-tagged combine (WS-1.2)

**Files:**
- Create: `lib/combine.ts`
- Create: `scripts/combine-db.ts`
- Modify: `package.json`
- Test: `tests/combine.test.ts`

**Interfaces:**
- Consumes: `data/remote/prod.db`, `data/remote/demo.db`
- Produces: `data/combined.db`; `combineInto(target: DB, sources: {source: string; db: DB}[]): CombineReport` from `lib/combine`, where `CombineReport = Record<string, number>` mapping table name to rows copied. `npm run combine`.

- [ ] **Step 1: Write the failing test**

Create `tests/combine.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import { combineInto, COMBINED_TABLES } from '../lib/combine';

function seedSource(mastery: number, note: string) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO categories (id, section, name, mastery) VALUES ('4A','chem_phys','Motion',?)").run(mastery);
  db.prepare("INSERT INTO results (category_id, difficulty, correct, mode, note) VALUES ('4A',1,1,'drill',?)").run(note);
  db.prepare("INSERT INTO transcripts (role, text) VALUES ('user', ?)").run(note);
  return db;
}

describe('combineInto', () => {
  test('tags every row with its source and preserves the original id', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'from-prod');
    const demo = seedSource(0.2, 'from-demo');

    combineInto(target, [
      { source: 'prod', db: prod },
      { source: 'demo', db: demo },
    ]);

    const rows = target.prepare('SELECT source, orig_id, note FROM results ORDER BY source').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'demo', orig_id: 1, note: 'from-demo' });
    expect(rows[1]).toMatchObject({ source: 'prod', orig_id: 1, note: 'from-prod' });

    for (const db of [target, prod, demo]) db.close();
  });

  test('reassigns ids so colliding source ids do not merge', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    const demo = seedSource(0.2, 'd');
    combineInto(target, [{ source: 'prod', db: prod }, { source: 'demo', db: demo }]);

    const ids = target.prepare('SELECT id FROM results').all().map((r) => (r as { id: number }).id);
    expect(new Set(ids).size).toBe(2); // both sources had orig_id 1
    for (const db of [target, prod, demo]) db.close();
  });

  test('takes categories from prod only — demo mastery describes nobody', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    const demo = seedSource(0.2, 'd');
    combineInto(target, [{ source: 'prod', db: prod }, { source: 'demo', db: demo }]);

    const cats = target.prepare('SELECT id, mastery FROM categories').all();
    expect(cats).toHaveLength(1);
    expect((cats[0] as { mastery: number }).mastery).toBeCloseTo(0.7);
    for (const db of [target, prod, demo]) db.close();
  });

  test('skips a table that does not exist in a source', () => {
    // tool_errors does not exist in the remote dbs until Task 2 is deployed there.
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    prod.exec('DROP TABLE tool_errors');

    expect(() => combineInto(target, [{ source: 'prod', db: prod }])).not.toThrow();
    for (const db of [target, prod]) db.close();
  });

  test('COMBINED_TABLES covers every row-bearing table the tuner reads', () => {
    expect(COMBINED_TABLES).toEqual(['results', 'episodes', 'transcripts', 'feedback', 'sessions', 'tool_errors']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/combine.test.ts`
Expected: FAIL — `Cannot find module '../lib/combine'`

- [ ] **Step 3: Write the combine module**

Create `lib/combine.ts`:

```typescript
import type { DB } from './db';

/**
 * Row-bearing tables copied into the combined db, each gaining `source` and `orig_id`.
 * `chunks` is deliberately excluded: embeddings are not tuning input.
 */
export const COMBINED_TABLES = [
  'results',
  'episodes',
  'transcripts',
  'feedback',
  'sessions',
  'tool_errors',
] as const;

export type CombineReport = Record<string, number>;

export interface CombineSource {
  source: string;
  db: DB;
}

function tableExists(db: DB, table: string): boolean {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table) as {
      n: number;
    }
  ).n > 0;
}

function columnsOf(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/**
 * Rebuilds `target` from `sources`. Ids are reassigned rather than preserved -- the two instances'
 * autoincrement ranges overlap, so merging on id would silently collide. `(source, orig_id)` is
 * the stable key.
 *
 * `categories` comes from the FIRST source only: mastery and due_at are per-instance student
 * state, and the demo instance's values describe nobody.
 */
export function combineInto(target: DB, sources: CombineSource[]): CombineReport {
  const report: CombineReport = {};

  for (const table of COMBINED_TABLES) {
    if (!tableExists(target, table)) continue;
    const targetCols = columnsOf(target, table);
    if (!targetCols.includes('source')) {
      target.exec(`ALTER TABLE ${table} ADD COLUMN source TEXT`);
    }
    if (!columnsOf(target, table).includes('orig_id')) {
      target.exec(`ALTER TABLE ${table} ADD COLUMN orig_id INTEGER`);
    }
    target.exec(`DELETE FROM ${table}`);
    report[table] = 0;
  }

  target.exec('DELETE FROM categories');

  const copy = target.transaction(() => {
    for (const [index, { source, db }] of sources.entries()) {
      if (index === 0 && tableExists(db, 'categories')) {
        const cats = db.prepare('SELECT * FROM categories').all() as Record<string, unknown>[];
        const cols = columnsOf(target, 'categories').filter((c) => c in (cats[0] ?? {}));
        if (cats.length > 0) {
          const stmt = target.prepare(
            `INSERT INTO categories (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
          );
          for (const row of cats) stmt.run(cols.map((c) => row[c]));
        }
      }

      for (const table of COMBINED_TABLES) {
        if (!tableExists(db, table) || !tableExists(target, table)) continue;

        const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
        if (rows.length === 0) continue;

        const shared = columnsOf(target, table).filter(
          (c) => c !== 'id' && c !== 'source' && c !== 'orig_id' && c in rows[0]
        );
        const cols = [...shared, 'source', 'orig_id'];
        const stmt = target.prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        );

        for (const row of rows) {
          stmt.run([...shared.map((c) => row[c]), source, row.id as number]);
        }
        report[table] = (report[table] ?? 0) + rows.length;
      }
    }
  });

  copy();
  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/combine.test.ts`
Expected: PASS

- [ ] **Step 5: Write the CLI**

Create `scripts/combine-db.ts`:

```typescript
/**
 * Rebuilds data/combined.db from the snapshots pulled by scripts/pull-remote.sh.
 * Rebuilt from scratch every run, never incrementally, so a bad run cannot poison the next one.
 */
import { existsSync, rmSync } from 'node:fs';
import { openDb } from '../lib/db';
import { combineInto } from '../lib/combine';

const SOURCES = [
  { source: 'prod', path: 'data/remote/prod.db' },
  { source: 'demo', path: 'data/remote/demo.db' },
];
const TARGET = 'data/combined.db';

function main(): void {
  const missing = SOURCES.filter((s) => !existsSync(s.path));
  if (missing.length > 0) {
    throw new Error(`Missing snapshot(s): ${missing.map((m) => m.path).join(', ')}. Run \`npm run pull\` first.`);
  }

  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(TARGET + suffix)) rmSync(TARGET + suffix);
  }

  const target = openDb(TARGET);
  const opened = SOURCES.map((s) => ({ source: s.source, db: openDb(s.path) }));

  try {
    const report = combineInto(target, opened);
    console.log(`Combined -> ${TARGET}`);
    for (const [table, count] of Object.entries(report)) {
      console.log(`  ${table.padEnd(14)} ${count}`);
    }
  } finally {
    for (const { db } of opened) db.close();
    target.close();
  }
}

main();
```

- [ ] **Step 6: Add the npm script**

In `package.json` `scripts`, add:

```json
    "combine": "tsx scripts/combine-db.ts",
```

- [ ] **Step 7: Acceptance run against real snapshots**

Run: `npm run pull && npm run combine`

Then paste the real counts:

```bash
sqlite3 data/combined.db "SELECT source, COUNT(*) FROM transcripts GROUP BY source"
sqlite3 data/combined.db "SELECT source, COUNT(*) FROM feedback GROUP BY source"
sqlite3 data/combined.db "SELECT COUNT(*) FROM results"
```

Expected: transcripts and feedback split across both sources; `results` reflects the exam-import rows now in prod. A green unit suite proves the logic matches its fixtures; only this proves the fixtures match the real databases.

- [ ] **Step 8: Full verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green

- [ ] **Step 9: Commit**

```bash
git add lib/combine.ts scripts/combine-db.ts package.json tests/combine.test.ts
git commit -m "feat: source-tagged combine of prod and demo databases

Ids are reassigned rather than preserved -- the two instances'
autoincrement ranges overlap and merging on id would silently collide.
categories comes from prod only: demo mastery describes nobody.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Tuner source filtering and 24-hour window (WS-1.3)

Two changes to `scripts/nightly-tune.ts`. The date change is a live bug fix, not just a refactor: the job runs at 23:00 US Central while SQLite stamps UTC, so `date(ts) = date('now')` asks for the wrong day *every* night.

**Files:**
- Modify: `scripts/nightly-tune.ts:59-107` (`gatherTuningData`), `:125-210` (`buildTuningPrompt`)
- Test: `tests/nightly-tune.test.ts`

**Interfaces:**
- Consumes: `combineInto` output shape (`source` column present or absent)
- Produces: `gatherTuningData` unchanged in signature; `TuningData` gains `toolErrors: ToolErrorRow[] | null` where `ToolErrorRow = { source: string | null; tool: string; message: string; count: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/nightly-tune.test.ts`:

```typescript
describe('source filtering', () => {
  function dbWithSource() {
    const db = openDb(':memory:');
    db.exec('ALTER TABLE results ADD COLUMN source TEXT');
    db.exec('ALTER TABLE transcripts ADD COLUMN source TEXT');
    db.prepare("INSERT INTO results (category_id,difficulty,correct,mode,source) VALUES ('4A',1,1,'drill','prod')").run();
    db.prepare("INSERT INTO results (category_id,difficulty,correct,mode,source) VALUES ('4A',1,0,'drill','demo')").run();
    db.prepare("INSERT INTO transcripts (role,text,source) VALUES ('user','real student','prod')").run();
    db.prepare("INSERT INTO transcripts (role,text,source) VALUES ('user','bystander audio','demo')").run();
    return db;
  }

  test('instruction-tuning inputs use prod only', () => {
    const db = dbWithSource();
    const data = gatherTuningData(db);
    expect(data.results).toHaveLength(1);
    expect(data.transcript?.map((t) => t.text)).toEqual(['real student']);
    expect(data.transcript?.map((t) => t.text)).not.toContain('bystander audio');
    db.close();
  });

  test('still works on a db with no source column', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO results (category_id,difficulty,correct,mode) VALUES ('4A',1,1,'drill')").run();
    expect(() => gatherTuningData(db)).not.toThrow();
    expect(gatherTuningData(db).results).toHaveLength(1);
    db.close();
  });
});

describe('24-hour window', () => {
  test('includes a row stamped 3 hours ago even when that is the previous UTC day', () => {
    const db = openDb(':memory:');
    db.prepare(
      "INSERT INTO results (ts,category_id,difficulty,correct,mode) VALUES (datetime('now','-3 hours'),'4A',1,1,'drill')"
    ).run();
    expect(gatherTuningData(db).results).toHaveLength(1);
    db.close();
  });

  test('excludes a row older than 24 hours', () => {
    const db = openDb(':memory:');
    db.prepare(
      "INSERT INTO results (ts,category_id,difficulty,correct,mode) VALUES (datetime('now','-30 hours'),'4A',1,1,'drill')"
    ).run();
    expect(gatherTuningData(db).results).toHaveLength(0);
    db.close();
  });
});

describe('tool errors in the prompt', () => {
  test('bugs section draws from both sources', () => {
    const db = openDb(':memory:');
    db.exec('ALTER TABLE tool_errors ADD COLUMN source TEXT');
    db.prepare("INSERT INTO tool_errors (tool,message,arg_keys,source) VALUES ('render_view','Too many rows','view','prod')").run();
    db.prepare("INSERT INTO tool_errors (tool,message,arg_keys,source) VALUES ('render_view','Too many rows','view','demo')").run();

    const prompt = buildTuningPrompt(gatherTuningData(db));
    expect(prompt).toContain('render_view');
    expect(prompt).toContain('Too many rows');
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly-tune.test.ts`
Expected: FAIL on source filtering and on the 24-hour window cases.

- [ ] **Step 3: Add a source-guard helper**

In `scripts/nightly-tune.ts`, below the existing `hasTable` function (line 51), add:

```typescript
/** True when `table` carries a `source` column -- absent on a plain local db. */
function hasSourceColumn(db: DB, table: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === 'source'
  );
}

/**
 * Instruction tuning must see prod dialogue only. The demo instance's transcripts are largely
 * ambient room audio the bot answered as if it were a student; tuning the examiner's
 * conversational behaviour on that would fit proposals to conversations no student had.
 */
function prodOnly(db: DB, table: string): string {
  return hasSourceColumn(db, table) ? `AND (source IS NULL OR source = 'prod')` : '';
}

/**
 * SQLite stamps datetime('now') in UTC; this job runs at 23:00 US Central, which is already the
 * next UTC day. A calendar-day query therefore asks for the wrong day every night. Use an
 * explicit lookback instead.
 */
const WINDOW = `ts >= datetime('now','-24 hours')`;
```

- [ ] **Step 4: Update every query in `gatherTuningData`**

Replace each `WHERE date(ts) = date('now')` with the windowed, source-filtered form. For results (line ~66):

```typescript
       WHERE ${WINDOW} ${prodOnly(db, 'results')}`
```

Apply the same to episodes (~line 79) and transcripts (~line 89), using `prodOnly(db, 'episodes')` and `prodOnly(db, 'transcripts')`.

For feedback (~line 102), keep BOTH sources — feedback is real wherever it came from — so only the window changes:

```typescript
           WHERE ${WINDOW} AND status = 'new'`
```

Leave line 60 alone. It reads `new Date().toISOString().slice(0, 10)`, which is already UTC and therefore already agrees with the timestamps in the data — it is the SQL `date(ts) = date('now')` comparisons that were wrong, not the report's own date label.

- [ ] **Step 5: Gather tool errors**

In `gatherTuningData`, before the `return`, add:

```typescript
  const toolErrors = hasTable(db, 'tool_errors')
    ? (db
        .prepare(
          `SELECT tool, message, COUNT(*) AS count,
                  ${hasSourceColumn(db, 'tool_errors') ? 'group_concat(DISTINCT source)' : 'NULL'} AS source
           FROM tool_errors
           WHERE ${WINDOW}
           GROUP BY tool, message
           ORDER BY count DESC
           LIMIT 20`
        )
        .all() as ToolErrorRow[])
    : null;
```

Add the type near the other row types (line ~31):

```typescript
export type ToolErrorRow = {
  tool: string;
  message: string;
  count: number;
  source: string | null;
};
```

Add `toolErrors` to the `TuningData` type and to the returned object.

- [ ] **Step 6: Add the Bugs section to the prompt**

In `buildTuningPrompt`, add a bugs block before the output-format instructions:

```typescript
    'BUGS (tool dispatch failures in the last 24h, from BOTH prod and demo — these contain no student content, so both sources count):',
    data.toolErrors === null
      ? '(tool_errors table not present)'
      : data.toolErrors.length > 0
        ? data.toolErrors
            .map((e) => `- ${e.tool}: ${e.message} (${e.count}x${e.source ? `, ${e.source}` : ''})`)
            .join('\n')
        : '(no tool errors in the last 24h)',
```

And extend the output-format instruction list with a third section:

```typescript
    '3. "## Bugs" — a numbered list, one per distinct tool failure above, each naming the likely cause in the app code and the smallest fix. Omit this section entirely if there are no bugs. These are defects, not tuning suggestions — keep them separate from both other sections.',
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/nightly-tune.test.ts`
Expected: PASS

- [ ] **Step 8: Acceptance run against the real combined db**

Run: `MCAT_DB=data/combined.db npx tsx scripts/nightly-tune.ts`

Expected: a proposal written to `docs/tuning/proposal-<today>.md` that references real prod feedback (the LaTeX/paste request, the interface-speed request, the table hiccup) and does NOT reference demo bystander dialogue. Read the file and confirm before committing.

- [ ] **Step 9: Full verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green

- [ ] **Step 10: Commit**

```bash
git add scripts/nightly-tune.ts tests/nightly-tune.test.ts
git commit -m "fix: tuner reads a 24h window and filters demo dialogue

The calendar-day query asked for the wrong day every night: SQLite
stamps UTC, the job runs 23:00 US Central. Instruction tuning now uses
prod dialogue only -- demo transcripts are largely bystander room audio
-- while feedback and tool errors draw from both.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Feedback write-back and job wiring (WS-1.3, WS-1.4)

Without write-back, the combined db is rebuilt nightly, `status` never persists, and prod feedback regenerates proposals forever.

**Files:**
- Create: `scripts/push-feedback-status.ts`
- Modify: `scripts/nightly-tune.ts` (`main`)
- Modify: `package.json`
- Test: `tests/feedback-writeback.test.ts`

**Interfaces:**
- Consumes: `data/combined.db` `feedback` rows carrying `source` and `orig_id`
- Produces: `buildWriteBackPlan(rows: {source: string; orig_id: number}[]): Record<string, number[]>` from `scripts/push-feedback-status.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/feedback-writeback.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { buildWriteBackPlan, buildUpdateSql } from '../scripts/push-feedback-status';

describe('buildWriteBackPlan', () => {
  test('groups original ids by source database', () => {
    expect(
      buildWriteBackPlan([
        { source: 'prod', orig_id: 1 },
        { source: 'prod', orig_id: 4 },
        { source: 'demo', orig_id: 2 },
      ])
    ).toEqual({ prod: [1, 4], demo: [2] });
  });

  test('ignores rows with no source (local db)', () => {
    expect(buildWriteBackPlan([{ source: null as unknown as string, orig_id: 9 }])).toEqual({});
  });
});

describe('buildUpdateSql', () => {
  test('touches only the status column, and only the given ids', () => {
    const sql = buildUpdateSql([1, 4]);
    expect(sql).toBe("UPDATE feedback SET status='proposed' WHERE id IN (1,4) AND status='new'");
  });

  test('rejects non-integer ids rather than interpolating them', () => {
    expect(() => buildUpdateSql([1, 2.5])).toThrow();
    expect(() => buildUpdateSql(['1); DROP TABLE feedback;--' as unknown as number])).toThrow();
  });

  test('returns empty string for no ids', () => {
    expect(buildUpdateSql([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feedback-writeback.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the module**

Create `scripts/push-feedback-status.ts`:

```typescript
/**
 * Marks feedback rows 'proposed' in the ORIGIN databases on the VPS.
 *
 * The combined db is rebuilt nightly, so a status written there evaporates and the same feedback
 * would regenerate proposals every night forever. This is the only step in the tuning pipeline
 * that mutates production: it touches feedback.status and nothing else.
 */
import { execFileSync } from 'node:child_process';

const HOST = process.env.MCAT_VPS_HOST ?? 'vps';
const APP_DIR = '/root/repos/mcat';
const DB_BY_SOURCE: Record<string, string> = { prod: 'data/mcat.db', demo: 'data/demo.db' };

export function buildWriteBackPlan(rows: { source: string; orig_id: number }[]): Record<string, number[]> {
  const plan: Record<string, number[]> = {};
  for (const row of rows) {
    if (!row.source) continue;
    (plan[row.source] ??= []).push(row.orig_id);
  }
  return plan;
}

export function buildUpdateSql(ids: number[]): string {
  if (ids.length === 0) return '';
  for (const id of ids) {
    if (!Number.isInteger(id)) throw new Error(`Refusing to interpolate a non-integer id: ${String(id)}`);
  }
  return `UPDATE feedback SET status='proposed' WHERE id IN (${ids.join(',')}) AND status='new'`;
}

export function pushWriteBack(plan: Record<string, number[]>): void {
  for (const [source, ids] of Object.entries(plan)) {
    const dbPath = DB_BY_SOURCE[source];
    if (!dbPath) {
      console.warn(`Unknown source '${source}' -- skipping write-back.`);
      continue;
    }
    const sql = buildUpdateSql(ids);
    if (!sql) continue;
    execFileSync('ssh', [HOST, `cd ${APP_DIR} && sqlite3 ${dbPath} "${sql}"`], { stdio: 'inherit' });
    console.log(`Marked ${ids.length} feedback row(s) proposed in ${source}.`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feedback-writeback.test.ts`
Expected: PASS

- [ ] **Step 5: Call it from the tuner, after the proposal is written**

In `scripts/nightly-tune.ts` `main()`, replace the existing `markFeedbackProposed(...)` call site so write-back runs only after the proposal file is successfully written:

```typescript
  // Only after the proposal file exists: a crash between generating and writing must not consume
  // the feedback.
  if (data.feedback && data.feedback.length > 0) {
    const rows = data.feedback as unknown as { id: number; source?: string; orig_id?: number }[];
    if (rows[0]?.source !== undefined) {
      pushWriteBack(buildWriteBackPlan(rows.map((r) => ({ source: r.source!, orig_id: r.orig_id! }))));
    } else {
      markFeedbackProposed(db, rows.map((r) => r.id));
    }
  }
```

Import at the top: `import { buildWriteBackPlan, pushWriteBack } from './push-feedback-status';`

Also extend the feedback SELECT in `gatherTuningData` to include `source` and `orig_id` when those columns exist, so the branch above has what it needs.

- [ ] **Step 6: Update the launchd job**

Rewrite the tune job's command so pull and combine run first and the sentinel is touched only on full success:

```bash
/usr/bin/plutil -p ~/Library/LaunchAgents/com.mcat.tune.plist
```

Then edit the `ProgramArguments` string to:

```
cd /path/to/mcat && set -a; . ./.env; set +a; npm run pull && npm run combine && MCAT_DB=data/combined.db npm run tune
```

Reload it:

```bash
launchctl unload ~/Library/LaunchAgents/com.mcat.tune.plist
launchctl load ~/Library/LaunchAgents/com.mcat.tune.plist
launchctl list | grep mcat
```

Note: the sentinel `touch` already lives at the end of `nightly-tune.ts`'s success path, so a failed pull or combine leaves it stale and the freshness monitor fires. Do not add a `touch` to the shell command.

- [ ] **Step 7: Full verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green

- [ ] **Step 8: Commit**

```bash
git add scripts/push-feedback-status.ts scripts/nightly-tune.ts package.json tests/feedback-writeback.test.ts
git commit -m "feat: write feedback status back to the origin databases

The combined db is rebuilt nightly, so a status written there evaporates
and the same feedback would regenerate proposals forever. Touches
feedback.status only, and only after the proposal file is written.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: KaTeX + mhchem rendering (WS-2)

Driven by prod feedback #4: *"add markdown or latex … to handle chemical formulas and equations for physics."*

**Files:**
- Create: `app/components/views/MathText.tsx`
- Modify: `app/components/views/AnswerGrid.tsx`, `FlashcardDeck.tsx`, `PassageView.tsx`, `DataTable.tsx`
- Modify: `app/layout.tsx` (KaTeX stylesheet import)
- Modify: `lib/instructions.ts` (NOTATION block)
- Modify: `package.json`
- Test: `tests/math-text.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<MathText text={string} />` default export from `app/components/views/MathText.tsx`, plus `renderMathSegments(text: string): {type: 'text'|'math', value: string, display: boolean}[]`

- [ ] **Step 1: Install KaTeX**

Run: `npm install katex && npm install --save-dev @types/katex`

- [ ] **Step 2: Write the failing test**

Create `tests/math-text.test.tsx`:

```typescript
import { describe, expect, test } from 'vitest';
import { renderMathSegments, renderToHtml } from '../app/components/views/MathText';

describe('renderMathSegments', () => {
  test('passes prose through untouched', () => {
    expect(renderMathSegments('just words')).toEqual([{ type: 'text', value: 'just words', display: false }]);
  });

  test('splits inline math out of surrounding prose', () => {
    expect(renderMathSegments('rate is $k[A]$ here')).toEqual([
      { type: 'text', value: 'rate is ', display: false },
      { type: 'math', value: 'k[A]', display: false },
      { type: 'text', value: ' here', display: false },
    ]);
  });

  test('recognises display math', () => {
    expect(renderMathSegments('$$E=mc^2$$')).toEqual([{ type: 'math', value: 'E=mc^2', display: true }]);
  });

  test('leaves a lone unmatched delimiter as literal text', () => {
    // Model output is unreliable; an unbalanced $ must not swallow the rest of the string.
    expect(renderMathSegments('costs $5 today')).toEqual([
      { type: 'text', value: 'costs $5 today', display: false },
    ]);
  });
});

describe('renderToHtml', () => {
  test('renders chemistry via mhchem', () => {
    const html = renderToHtml('\\ce{H2SO4}', false);
    expect(html).toContain('katex');
    expect(html).toContain('SO');
  });

  test('degrades malformed input to visible source instead of throwing', () => {
    expect(() => renderToHtml('\\frac{', false)).not.toThrow();
    expect(renderToHtml('\\frac{', false)).toContain('katex');
  });

  test('does not emit an anchor for \\href — trust is disabled', () => {
    const html = renderToHtml('\\href{https://evil.example}{click}', false);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="https://evil.example"');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/math-text.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Write the component**

Create `app/components/views/MathText.tsx`:

```typescript
import katex from 'katex';
import 'katex/contrib/mhchem';

export interface MathSegment {
  type: 'text' | 'math';
  value: string;
  display: boolean;
}

/**
 * Splits a string into prose and math segments on $...$ / $$...$$.
 *
 * An unmatched delimiter yields literal text rather than consuming the remainder: model output is
 * unreliable, and a stray "$5" must not turn the rest of a question stem into math.
 */
export function renderMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', value: text.slice(last, match.index), display: false });
    }
    segments.push({
      type: 'math',
      value: (match[1] ?? match[2]).trim(),
      display: match[1] !== undefined,
    });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last), display: false });
  }
  return segments.length > 0 ? segments : [{ type: 'text', value: text, display: false }];
}

/**
 * throwOnError: false -- malformed model output degrades to visible source rather than blanking
 * the panel. trust: false -- blocks \href and \htmlClass, which would otherwise be an injection
 * path through dangerouslySetInnerHTML.
 */
export function renderToHtml(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
  });
}

export default function MathText({ text }: { text: string }) {
  const segments = renderMathSegments(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <span
            key={index}
            dangerouslySetInnerHTML={{ __html: renderToHtml(segment.value, segment.display) }}
          />
        )
      )}
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/math-text.test.tsx`
Expected: PASS

- [ ] **Step 6: Import the stylesheet**

In `app/layout.tsx`, add alongside the existing global style import:

```typescript
import 'katex/dist/katex.min.css';
```

- [ ] **Step 7: Apply to the four view components**

In `AnswerGrid.tsx`, replace `<span>{option}</span>` with:

```tsx
              <span><MathText text={option} /></span>
```

and add `import MathText from './MathText';` at the top.

Apply the same substitution in:
- `FlashcardDeck.tsx` — the card front and back text nodes
- `PassageView.tsx` — leave the `html` field alone (it is already HTML), but wrap the `title` if rendered as text
- `DataTable.tsx` — each header cell and each body cell

- [ ] **Step 8: Add the NOTATION instruction**

In `lib/instructions.ts`, add a new paragraph after the DISPLAY paragraph:

```
NOTATION: Speak all notation in words — say "H two S O four", never read LaTeX aloud. In render_view payloads ONLY, you may write math as LaTeX between single dollar signs for inline ($v = v_0 + at$) or double for display. Use \\ce{...} for chemical formulas and equations, e.g. $\\ce{H2SO4 -> H+ + HSO4-}$. Never put LaTeX in anything you say out loud.
```

- [ ] **Step 9: Visual check at 375px**

Run `npm run dev`, open `/debug/views`, and confirm an `answer_grid` with `$\ce{H2SO4 -> H+ + HSO4-}$` in an option renders as formatted chemistry with no horizontal page scroll at 375px width. House rule: mobile-friendly by default.

- [ ] **Step 10: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: green

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json app/components/views/MathText.tsx app/components/views/ app/layout.tsx lib/instructions.ts tests/math-text.test.tsx
git commit -m "feat: render LaTeX and chemistry notation in view payloads

KaTeX + mhchem, self-hosted. Scoped to render_view payloads only: the
transcript is a record of speech, and the model is instructed to speak
notation in words. throwOnError false so malformed output degrades to
visible source; trust false so \\href cannot inject markup.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Text input into the live session (WS-3)

**Files:**
- Modify: `lib/realtime-client.ts`
- Modify: `app/page.tsx`
- Test: `tests/user-text.test.ts`

**Interfaces:**
- Consumes: `RealtimeClient.sendEvent`, `RealtimeClient.requestResponse`
- Produces: `buildUserTextItem(text: string): object` and `MAX_USER_TEXT_LENGTH: number` exported from `lib/realtime-client`; `RealtimeClient.sendUserText(text: string): void`

- [ ] **Step 1: Write the failing test**

Create `tests/user-text.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { buildUserTextItem, MAX_USER_TEXT_LENGTH } from '../lib/realtime-client';

describe('buildUserTextItem', () => {
  test('builds the same shape the reconnect resume path already uses', () => {
    expect(buildUserTextItem('why is it B?')).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'why is it B?' }],
      },
    });
  });

  test('trims surrounding whitespace', () => {
    expect(buildUserTextItem('  hi  ')).toMatchObject({
      item: { content: [{ type: 'input_text', text: 'hi' }] },
    });
  });

  test('rejects empty or whitespace-only input', () => {
    expect(() => buildUserTextItem('')).toThrow();
    expect(() => buildUserTextItem('   ')).toThrow();
  });

  test('rejects input beyond the length cap', () => {
    expect(() => buildUserTextItem('x'.repeat(MAX_USER_TEXT_LENGTH + 1))).toThrow();
    expect(() => buildUserTextItem('x'.repeat(MAX_USER_TEXT_LENGTH))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/user-text.test.ts`
Expected: FAIL — `buildUserTextItem` is not exported

- [ ] **Step 3: Add the builder and client method**

In `lib/realtime-client.ts`, near `RESUME_MESSAGE` (line ~125), add:

```typescript
/** Matches the transcript row cap in app/api/transcript/route.ts. */
export const MAX_USER_TEXT_LENGTH = 4000;

/**
 * Builds the conversation item for a typed student turn. Same event shape the reconnect resume
 * already sends, so this path is proven in production rather than inferred from the API docs.
 */
export function buildUserTextItem(text: string): object {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('Cannot send an empty message.');
  if (trimmed.length > MAX_USER_TEXT_LENGTH) {
    throw new Error(`Message exceeds ${MAX_USER_TEXT_LENGTH} characters.`);
  }
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: trimmed }] },
  };
}
```

Inside `class RealtimeClient`, after `sendImage` (line ~236), add:

```typescript
  /** Sends a typed student turn and asks for a response. */
  sendUserText(text: string): void {
    this.sendEvent(buildUserTextItem(text));
    this.requestResponse();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/user-text.test.ts`
Expected: PASS

- [ ] **Step 5: Add the input to the page**

In `app/page.tsx`, add state near the other `useState` declarations (~line 168):

```typescript
  const [draft, setDraft] = useState('');
```

Add a handler near the other callbacks:

```typescript
  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (!text || !connected || !clientRef.current) return;
    try {
      clientRef.current.sendUserText(text);
      // Mirror into the transcript so typed turns reach the tuner's dialogue view; without this
      // a typed session is invisible to the nightly tuner.
      appendTranscript({ role: 'user', text });
      setDraft('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send message.');
    }
  }, [draft, connected, appendTranscript]);
```

Use whatever the existing transcript-append helper is named in this file (see the buffering code around line 249) rather than introducing a new one.

Render it below the transcript strip:

```tsx
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendDraft();
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!connected}
            maxLength={MAX_USER_TEXT_LENGTH}
            placeholder={connected ? 'Type a question…' : 'Connect to type'}
            aria-label="Send a typed message"
          />
          <button type="submit" disabled={!connected || draft.trim().length === 0}>
            Send
          </button>
        </form>
```

Import `MAX_USER_TEXT_LENGTH` from `@/lib/realtime-client`.

- [ ] **Step 6: Style it for 375px**

In `app/page.module.css` (or the stylesheet the page already uses), add a `.composer` rule with `display: flex; gap: .5rem;` and an input of `flex: 1; min-width: 0;`. Verify at 375px that the row does not overflow horizontally.

- [ ] **Step 7: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: green

- [ ] **Step 8: Commit**

```bash
git add lib/realtime-client.ts app/page.tsx app/page.module.css tests/user-text.test.ts
git commit -m "feat: text input as a second channel into the live session

Reuses the conversation.item.create + response.create path the reconnect
resume already proves in production. Typed turns are mirrored into the
transcript so they reach the nightly tuner.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Sentry instrumentation with request-body scrubbing (WS-5, part 1)

**Files:**
- Create: Sentry instrumentation files (names per the installed Next 16 docs)
- Create: `lib/sentry-scrub.ts`
- Modify: `.env.example`
- Test: `tests/sentry-scrub.test.ts`

**Interfaces:**
- Consumes: `SENTRY_DSN` env var
- Produces: `scrubEvent(event: {request?: {data?: unknown}; user?: unknown}): typeof event` from `lib/sentry-scrub`

**Blocked on:** the user creating the Sentry project and supplying `SENTRY_DSN`. The code must be written so it is inert without one — implement and test it now; the DSN only affects whether events are transmitted.

- [ ] **Step 1: Read the Next 16 instrumentation docs**

Run: `ls node_modules/next/dist/docs/ && grep -rl "instrumentation" node_modules/next/dist/docs/ | head`

Read the relevant file. Next 16's instrumentation-file contract differs from earlier versions; do not assume `sentry.client.config.ts` / `sentry.server.config.ts` from training data.

- [ ] **Step 2: Write the failing test**

Create `tests/sentry-scrub.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { scrubEvent } from '../lib/sentry-scrub';

describe('scrubEvent', () => {
  test('strips the request body', () => {
    // /api/tool receives question stems and studentReasoning; a 500 on that route would
    // otherwise ship a student's reasoning to Sentry.
    const event = {
      request: { data: { name: 'record_episode', args: { studentReasoning: 'I guessed' } }, url: '/api/tool' },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request?.data).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('guessed');
  });

  test('keeps the url, which carries no student content', () => {
    expect(scrubEvent({ request: { data: { a: 1 }, url: '/api/tool' } }).request?.url).toBe('/api/tool');
  });

  test('never attaches a user identity', () => {
    expect(scrubEvent({ user: { id: 'student-1', email: 'a@example.com' } }).user).toBeUndefined();
  });

  test('is a no-op on an event with neither field', () => {
    expect(scrubEvent({})).toEqual({});
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/sentry-scrub.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the scrubber**

Create `lib/sentry-scrub.ts`:

```typescript
/**
 * Privacy posture for this app.
 *
 * There is no account system: prod is a single student behind basic auth, demo is anonymous and
 * public. No user identity is ever sent. Request bodies are stripped because /api/tool receives
 * question stems and studentReasoning.
 */
export interface ScrubbableEvent {
  request?: { data?: unknown; url?: string };
  user?: unknown;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
  }
  if ('user' in event) {
    delete event.user;
  }
  return event;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/sentry-scrub.test.ts`
Expected: PASS

- [ ] **Step 6: Install and initialise the SDK**

Run: `npm install @sentry/nextjs`

Create the instrumentation files the installed docs specify. Every `Sentry.init` call must use:

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubEvent(event as ScrubbableEvent) as typeof event,
});
```

Do NOT enable Session Replay — it records form input.

Tag the instance so prod and demo are distinguishable in one Sentry project, reusing the hostname logic already shipped in `eb689be`:

```typescript
Sentry.setTag('instance', typeof window !== 'undefined' && window.location.hostname.startsWith('mcatdemo') ? 'demo' : 'prod');
```

- [ ] **Step 7: Document the env vars**

Add to `.env.example`:

```
# Sentry (optional — everything is inert when SENTRY_DSN is unset)
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

- [ ] **Step 8: Verify it is inert without a DSN**

Run: `npm run build && npx vitest run`
Expected: green with no `SENTRY_DSN` set, and no network calls attempted at build time.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/sentry-scrub.ts .env.example tests/sentry-scrub.test.ts instrumentation*.ts
git commit -m "feat: Sentry with request-body scrubbing, inert without a DSN

No user identity is ever sent -- there is no account system. Request
bodies are stripped because /api/tool receives question stems and
studentReasoning. Instances distinguished by an instance tag rather than
by identifying the student.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Nightly Sentry fetch into the proposal and briefing (WS-5, part 2)

**Files:**
- Create: `lib/sentry-issues.ts`
- Create: `scripts/fetch-sentry.ts`
- Modify: `scripts/nightly-tune.ts`, `lib/briefing.ts`
- Test: `tests/sentry-issues.test.ts`

**Interfaces:**
- Consumes: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- Produces: `parseIssues(payload: unknown): SentryIssue[]` and `formatIssues(issues: SentryIssue[] | null): string` from `lib/sentry-issues`, where `SentryIssue = { id: string; title: string; count: number; culprit: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/sentry-issues.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { formatIssues, parseIssues } from '../lib/sentry-issues';

const FIXTURE = [
  { id: '1', title: 'TypeError: x is not a function', count: '14', culprit: 'app/page.tsx' },
  { id: '2', title: 'Failed to fetch', count: '3', culprit: 'lib/realtime-client.ts' },
];

describe('parseIssues', () => {
  test('parses the issues payload, coercing the string count', () => {
    expect(parseIssues(FIXTURE)).toEqual([
      { id: '1', title: 'TypeError: x is not a function', count: 14, culprit: 'app/page.tsx' },
      { id: '2', title: 'Failed to fetch', count: 3, culprit: 'lib/realtime-client.ts' },
    ]);
  });

  test('returns an empty list for a non-array payload rather than throwing', () => {
    expect(parseIssues({ detail: 'Invalid token' })).toEqual([]);
    expect(parseIssues(null)).toEqual([]);
  });

  test('skips malformed entries instead of failing the whole fetch', () => {
    expect(parseIssues([{ id: '1' }, FIXTURE[0]])).toHaveLength(1);
  });
});

describe('formatIssues', () => {
  test('null means Sentry was unavailable, which must be said out loud', () => {
    // A Sentry outage must not silently look like "no errors".
    expect(formatIssues(null)).toBe('(Sentry unavailable)');
  });

  test('empty means genuinely no issues', () => {
    expect(formatIssues([])).toBe('(no unresolved Sentry issues in the last 24h)');
  });

  test('renders one line per issue, most frequent first', () => {
    expect(formatIssues(parseIssues(FIXTURE))).toBe(
      '- TypeError: x is not a function (14x, app/page.tsx)\n- Failed to fetch (3x, lib/realtime-client.ts)'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sentry-issues.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the module**

Create `lib/sentry-issues.ts`:

```typescript
export interface SentryIssue {
  id: string;
  title: string;
  count: number;
  culprit: string;
}

export function parseIssues(payload: unknown): SentryIssue[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((raw): SentryIssue[] => {
    if (raw === null || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string') return [];
    return [
      {
        id: r.id,
        title: r.title,
        count: Number(r.count ?? 0),
        culprit: typeof r.culprit === 'string' ? r.culprit : '',
      },
    ];
  });
}

/**
 * null means the fetch failed. That must read differently from an empty list: a Sentry outage
 * silently rendering as "no errors" is exactly the failure the sentinel discipline exists to
 * prevent.
 */
export function formatIssues(issues: SentryIssue[] | null): string {
  if (issues === null) return '(Sentry unavailable)';
  if (issues.length === 0) return '(no unresolved Sentry issues in the last 24h)';

  return [...issues]
    .sort((a, b) => b.count - a.count)
    .map((i) => `- ${i.title} (${i.count}x${i.culprit ? `, ${i.culprit}` : ''})`)
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sentry-issues.test.ts`
Expected: PASS

- [ ] **Step 5: Write the fetcher**

Create `scripts/fetch-sentry.ts`:

```typescript
import { parseIssues, type SentryIssue } from '../lib/sentry-issues';

/**
 * Returns null on ANY failure -- missing token, network error, non-200. The caller renders that
 * as "(Sentry unavailable)" and continues: this must never fail the nightly run, because the
 * tune sentinel gates on success and a Sentry outage staling the freshness monitor would be a
 * false alarm about the tuner.
 */
export async function fetchSentryIssues(): Promise<SentryIssue[] | null> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!token || !org || !project) return null;

  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=24h`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return parseIssues(await response.json());
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Fold into the proposal**

In `scripts/nightly-tune.ts`, import `fetchSentryIssues` and `formatIssues`, await the fetch in `main()`, and extend the BUGS prompt block added in Task 5:

```typescript
    'SENTRY (unresolved issues, last 24h — client crashes and API failures that tool_errors cannot see):',
    formatIssues(sentryIssues),
```

- [ ] **Step 7: Name the top 2 in the briefing**

In `lib/briefing.ts`, `buildBriefing` is synchronous and takes `(db, examDate)`. Keep it synchronous — making it async would force every caller and every existing test to change. Instead let the caller do the fetching and pass the result in, via a new optional third parameter:

```typescript
export function buildBriefing(db: DB, examDate: string, bugs: string[] = []): string {
```

and render, when non-empty:

```typescript
    bugs.length > 0 ? `\n## Open bugs\n${bugs.slice(0, 2).map((b) => `- ${b}`).join('\n')}` : '',
```

`scripts/briefing.ts` passes the top 2 issue titles from `fetchSentryIssues()`, falling back to `[]` when it returns null.

- [ ] **Step 8: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: green. Tests must make no live API calls.

- [ ] **Step 9: Commit**

```bash
git add lib/sentry-issues.ts scripts/fetch-sentry.ts scripts/nightly-tune.ts scripts/briefing.ts lib/briefing.ts tests/sentry-issues.test.ts
git commit -m "feat: pull Sentry issues into the nightly proposal and briefing

Surface-only: nothing is auto-fixed or auto-filed. Any fetch failure
degrades to '(Sentry unavailable)' and continues, so a Sentry outage
cannot stale the tune sentinel and raise a false alarm about the tuner.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** WS-1.1 → Task 3; WS-1.2 → Task 4; WS-1.3 → Tasks 5 and 6; WS-1.4 → Task 6; WS-2 → Task 7; WS-3 → Task 8; WS-4 → Task 2; WS-5 → Tasks 9 and 10; scope addition (`data_table` cap) → Task 1. No spec section is unimplemented.

**Deferred by the spec, deliberately absent here:** Wave B standalone chat mode; autonomous Sentry fixing; applying `proposal-2026-08-10.md`.

**Known external dependency:** Task 9 and Task 10 are code-complete without a Sentry DSN but transmit nothing until the user creates the project. Both are written to be inert rather than broken when the env vars are absent, so they can land and be verified before that happens.

**Deployment note not covered by any task:** Tasks 1, 2, 7, and 8 change the app itself and only reach the student after a VPS deploy (`git pull` + `npm run build` + `pm2 restart mcat mcat-demo`). Task 2's `tool_errors` table must exist in the remote dbs before Task 4's combine will report tool errors from them — the table is created by `openDb()` on first run after deploy.
