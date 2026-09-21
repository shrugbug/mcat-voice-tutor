# MCAT Study Bot — Operations Runbook

This runbook covers the deployed instances, npm scripts, nightly data pipeline, AAMC score imports, backup/restore, and the failure modes recorded in the project docs. It is written from the `docs/operations-runbook` branch of `/path/to/mcat-docs`.

> **Scope caveat:** The live launchd jobs and VPS checkout both point at `/path/to/mcat` (same repo, on `main` at `df1e39a` at the time of writing), not at this `mcat-docs` worktree. This runbook describes the code and jobs as they exist; some fixes are on unmerged branches and are noted where relevant.
>
> **Precondition note:** Several sections below describe the intended post-merge state of the tuning-loop / LaTeX-input wave — the `pull -> combine -> tune` pipeline, the `tool_errors` table, Sentry instrumentation, the `data_table` 60-row cap, the 24-hour tuning window, and feedback status write-back. These are implemented on `feat/tuner-pipeline` and/or `feat/app-latex-input` and are **not yet live** on `main` or the VPS until those branches merge and deploy. Current `main` has the original `data_table` 30-row cap and no `tool_errors`/Sentry/pipeline.

---

## 1. Deployed instances

Both instances live on the same VPS checkout at `/root/repos/mcat` (ssh alias `vps`) and are managed by `pm2`. They share one build and one repo but run on different ports and use different database files via the `MCAT_DB` env var.

| | Prod | Demo |
|---|---|---|
| URL | `mcat.illinihunt.org` | `mcatdemo.illinihunt.org` |
| `pm2` app | `mcat` | `mcat-demo` |
| Port | `3007` | `3008` |
| Database | `data/mcat.db` | `data/demo.db` |
| Auth / audience | Basic auth, single student | Basic auth (since 2026-08-10), credentials in `DEMO_CREDENTIALS.txt` on the VPS |
| Personalization | `NEXT_PUBLIC_STUDENT_NAME`/`NEXT_PUBLIC_STUDENT_FILE_LABEL` in the instance `.env` | Generic greeting (`future doctor`) via `window.location.hostname` |

Common VPS commands:

```sh
ssh vps
pm2 status
pm2 logs mcat
pm2 logs mcat-demo
pm2 restart mcat mcat-demo
```

Deploy flow (2026-09-02 onward): a single script on the VPS, `/usr/local/bin/mcat-deploy`, does
fetch, `git reset --hard origin/main` (idempotent, survives history rewrites), `npm install`,
`npm run build`, `pm2 restart mcat mcat-demo`, then curls both ports and appends a line to
`/var/log/mcat-deploy.log`. It never touches `data/*.db` or `.env`.

```sh
ssh vps mcat-deploy                # as root
ssh vps sudo mcat-deploy           # as a deploy user
ssh vps sudo mcat-deploy origin/some-branch   # deploy a non-main ref
```

Auto-deploy: `.github/workflows/deploy.yml` runs on every push to `main` (and on manual
dispatch). It SSHes as `deployer@$VPS_HOST` with the `VPS_SSH_KEY` repo secret; that key is a
forced command in `/home/deployer/.ssh/authorized_keys`, so it can only run `sudo mcat-deploy`
(`/etc/sudoers.d/deployer-mcat`). Secrets: `VPS_SSH_KEY`, `VPS_HOST`, `VPS_KNOWN_HOSTS`. The
private key exists only in the GitHub secret; to rotate, `ssh-keygen -t ed25519`, replace the
key line in that `authorized_keys`, and `gh secret set VPS_SSH_KEY < newkey`.

Manual deploy users: `shreya` (created 2026-09-02) is a normal Linux user whose sudo is limited by
`/etc/sudoers.d/shreya-mcat-deploy` to `mcat-deploy` and `pm2 status|logs|restart` on the two
mcat apps. No shell access to `/root`, other pm2 apps, or Postgres. To add a key:
`ssh vps 'echo "<pubkey>" >> /home/shreya/.ssh/authorized_keys'`. Same pattern for any future
collaborator: `useradd -m`, copy the sudoers file with the name changed.

> **Production data:** `pm2 restart` is non-destructive. The reset/install/build steps are
> non-destructive for the database but do change the running build. `mcat-deploy` prints
> `pm2 status` and the two health codes at the end; read them.

Both vhosts sit behind nginx basic auth (`/etc/nginx/.htpasswd-mcat`, `.htpasswd-mcatdemo`,
since 2026-08-10), so a public `curl` returns 401 even when healthy. Health-check the localhost
ports instead, as the script does.

The exact `pm2` start command / ecosystem file used on the VPS is **unverified** — it is not in the repo. The app is expected to use `PORT` and `MCAT_DB` env vars per process.

---

## 2. npm scripts

Default database path for all scripts is `data/mcat.db` (or `MCAT_DB` env override). `data/` is gitignored; do not commit it.

| Script | Runs | What it does | What it writes | Safe to re-run? |
|---|---|---|---|---|
| `npm run dev` | `next dev` | Local dev server on `localhost:3000`. Loads `.env` through Next.js. | Nothing persistent except through the running app. | Yes. |
| `npm run build` | `next build` | Production build. | `.next/` output. | Yes. |
| `npm start` | `next start` | Production server. Default port `3000`; override with `PORT`. | Nothing. | Yes. |
| `npm run lint` | `eslint` | Lints the project. | Nothing. | Yes. |
| `npm run seed -- --cp <s> --cars <s> --bb <s> --ps <s>` | `scripts/seed.ts` | Loads `data/taxonomy.json`, upserts all categories, sets mastery per section score. | `categories` rows in `data/mcat.db` (or `MCAT_DB`). | Yes — idempotent upsert. |
| `npm run seed -- --taxonomy-only` | `scripts/seed.ts` | Loads taxonomy, sets mastery to `0.5` for all categories. | `categories` rows. | Yes. |
| `npm run ingest -- pdfs/*.pdf` | `scripts/ingest.ts` | Extracts pages with `pdftotext`, chunks, embeds, writes chunks. | `chunks` rows in `data/mcat.db` (or `MCAT_DB`); also gitignored. | Yes, with caveats: without `--force` it skips already-ingested sources; with `--force` it deletes and re-inserts that source only; `--dry-run` performs no writes. Requires `pdftotext` (Poppler). |
| `npm run acceptance` | `scripts/acceptance.ts` | Drives `/api/tool` through a drill session. | `results` and `sessions` rows in the dev server's database. | **No** against the real student DB. Must start the dev server with `MCAT_DB=data/acceptance.db` and run a fresh seed. Has a guard to abort if the profile looks like a real DB. |
| `npm run briefing` | `scripts/briefing.ts` | Builds a morning briefing. | `docs/briefings/YYYY-MM-DD.md` and `~/.cron-sentinels/mcat-briefing` (on success). | Yes — overwrites today's briefing and updates the sentinel. |
| `npm run tune` | `scripts/nightly-tune.ts` | Gathers today's (UTC calendar) `results`, `episodes`, `transcripts`, and `feedback` and asks the tuning model for proposals. | `docs/tuning/proposal-YYYY-MM-DD.md` and `~/.cron-sentinels/mcat-tune` (on success); also marks `feedback.status = 'proposed'` in the DB it reads. | Yes, but the same `feedback` rows may not re-appear if already marked `proposed`; on a plain local DB the same data can re-propose. |
| `npm run import-exam -- <csv> --exam <id> [--apply] [--db path]` | `scripts/import-exam.ts` | Parses an AAMC full-length score-report CSV. | `--apply` only: deletes and re-inserts `mode='exam_import'` rows for `<id>`, then recomputes category mastery. | Yes — re-running the same `--exam` id replaces rather than duplicates. Dry-run by default. |

The `pull` and `combine` scripts are **not in this branch's `package.json`**; they exist on `feat/tuner-pipeline` and are described in the Nightly pipeline section below.

### Script details worth knowing

- `seed` refuses mismatched flags and requires all four scores unless `--taxonomy-only` is used.
- `ingest` aborts a `--force` run if extraction produces zero chunks, to avoid deleting an existing index and replacing it with nothing.
- `tune` uses `QUESTION_MODEL` (default `gpt-5.1`) and a 60-second timeout.
- `import-exam` throws if the CSV references categories not in the taxonomy; run `seed` first.

---

## 3. Nightly data pipeline

### 3.1 What is actually running now

The live launchd jobs were found in `~/Library/LaunchAgents` and run from `/path/to/mcat`:

- `com.mcat.briefing` — runs `npm run briefing` at **07:30** daily.
- `com.mcat.tune` — runs `npm run tune` at **23:00** daily.

Both source `.env` before running:

```sh
cd /path/to/mcat && set -a; . ./.env; set +a; /path/to/npm run <script>
```

Sentinels are written only on the success path:

- `~/.cron-sentinels/mcat-briefing`
- `~/.cron-sentinels/mcat-tune`

Check freshness:

```sh
ls -l ~/.cron-sentinels/mcat-*
cat ~/.cron-sentinels/mcat-*
```

Logs:

- `~/Library/Logs/mcat-briefing.log`
- `~/Library/Logs/mcat-tune.log`

**Current problem (verified):** the `tune` job reads the **local** `data/mcat.db` in `/path/to/mcat`, not the VPS databases. As of the 2026-08-10 session log, that local DB contains only 5 synthetic attempts, while prod has 32 transcripts + 4 feedback and demo has 30 transcripts. Nightly proposals are therefore generated from synthetic data until the pipeline below is wired.

### 3.2 The planned `pull -> combine -> tune` pipeline

This pipeline is implemented on `feat/tuner-pipeline` and approved in `docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md`. It is **not yet active** in the `mcat` checkout.

```sh
# 1. Pull WAL-safe snapshots from the VPS.
#    Writes data/remote/prod.db and data/remote/demo.db (gitignored).
npm run pull

# 2. Combine them into one analysis database.
#    Writes data/combined.db from scratch.
npm run combine

# 3. Tune on the combined data.
#    Writes docs/tuning/proposal-YYYY-MM-DD.md.
MCAT_DB=data/combined.db npm run tune
```

`scripts/pull-remote.sh` (from `feat/tuner-pipeline`):

- Both remote DBs are `journal_mode=WAL`. A plain `rsync` of a live WAL DB can copy a torn page set or miss commits still in the `-wal` file, so the script snapshots server-side with SQLite's online backup API first:
  ```sh
  ssh vps "cd /root/repos/mcat && sqlite3 data/mcat.db \".backup '/tmp/mcat-pull-<pid>-prod.db'\""
  rsync vps:/tmp/mcat-pull-<pid>-prod.db data/remote/prod.db
  ssh vps "rm -f /tmp/mcat-pull-<pid>-prod.db"
  ```
- Same for `data/demo.db` -> `data/remote/demo.db`.
- Refuses to continue if the snapshot has 0 categories.
- `MCAT_VPS_HOST` defaults to `vps`.

`scripts/combine-db.ts` + `lib/combine.ts`:

- Rebuilds `data/combined.db` from scratch every run (delete + recreate). On `feat/tuner-pipeline` this file is in `.gitignore`; on the current `docs/operations-runbook` branch it is not, so do not commit it if you create it.
- Copies row-bearing tables: `results`, `episodes`, `transcripts`, `feedback`, `sessions`, `tool_errors`.
- Each row gains `source TEXT` (`prod` or `demo`) and `orig_id INTEGER`.
- `id` is reassigned, not preserved, because autoincrement ranges overlap between instances. `(source, orig_id)` is the stable key.
- `categories` is copied from **prod only**; demo categories describe nobody.
- `chunks` is excluded; embeddings are not tuning input.
- Gracefully skips tables/columns that do not yet exist.

`scripts/nightly-tune.ts` (updated on `feat/tuner-pipeline`):

- Uses a 24-hour lookback (`ts >= datetime('now','-24 hours')`) instead of calendar-day, because 23:00 US Central is already the next UTC day.
- Instruction-tuning inputs (`results`, `episodes`, `transcripts`) are filtered to `source='prod'`.
- Feedback and `tool_errors` are drawn from **both** prod and demo.
- After writing the proposal, it pushes `UPDATE feedback SET status='proposed' ...` back to the origin databases on the VPS, keyed on `orig_id`. This is the only step that mutates production data.

> **Production data:** `pushWriteBack` touches only `feedback.status` on `data/mcat.db` and `data/demo.db` on the VPS. It runs only after the proposal file has been successfully written.

### 3.3 Sentinel discipline

Both `scripts/briefing.ts` and `scripts/nightly-tune.ts` write their sentinel as the **last** success step. If any earlier step fails, the sentinel file is left stale.

```sh
# On the Mac:
mkdir -p ~/.cron-sentinels
date -u +%Y-%m-%dT%H:%M:%S.%3NZ > ~/.cron-sentinels/mcat-briefing
date -u +%Y-%m-%dT%H:%M:%S.%3NZ > ~/.cron-sentinels/mcat-tune
```

A freshness monitor can therefore detect failures by checking the sentinel age.

---

## 4. Importing AAMC score reports

Command:

```sh
npm run import-exam -- <csv> --exam AAMC-FL4
```

- **Dry-run by default.** It prints the parsed rows and a mastery preview; it writes nothing.
- `--exam <id>` is required and acts as a provenance key for re-runs.
- `--apply` is required to commit.
- `--db <path>` overrides the target DB (default `data/mcat.db` or `MCAT_DB`).

What it does on `--apply`:

1. Parses the AAMC CSV using a small RFC-4180 parser (handles quoted fields).
2. Resolves each question to a taxonomy category, CARS skill to one of the `cars_*` categories, and difficulty (`Easy/Moderate/Difficult/Expert` → `1/2/3/3`).
3. Deletes existing `mode='exam_import'` rows whose `note` starts with the same `<examId>`.
4. Inserts new rows.
5. Recomputes mastery for **all** categories from the full `results` table using `shrunkMastery(correct, attempts) = (correct + 2) / (attempts + 4)`.

Re-running with the same `--exam` id replaces rather than duplicates.

```sh
# Re-run after getting a new report for the same exam:
npm run import-exam -- AAMC-FL4-scored.csv --exam AAMC-FL4 --apply

# Import into a different database:
npm run import-exam -- report.csv --exam AAMC-FL1 --db data/demo.db --apply
```

> **Production data:** `--apply` changes `results` and recomputes `categories.mastery`. Treat it like writing real exam results.

---

## 5. Database backup and restore

All databases are opened with `journal_mode=WAL` (`lib/db.ts:7`). WAL mode means the `-wal` and `-shm` files hold recent commits; a plain file copy while the app is running can be inconsistent.

### Making a WAL-safe backup

Use SQLite's online backup API from the `sqlite3` shell:

```sh
ssh vps
cd /root/repos/mcat
sqlite3 data/mcat.db ".backup '/path/to/mcat-YYYY-MM-DD.db'"
sqlite3 data/demo.db ".backup '/path/to/demo-YYYY-MM-DD.db'"
```

This produces a consistent snapshot while the app keeps running. The output file is a normal SQLite database that can be moved off the VPS.

### Where backups live on the VPS

The repo does **not** define a persistent backup storage path or schedule on the VPS. The tuning pipeline's `pull-remote.sh` uses `.backup` only as a transient pull step:

- It writes a temp snapshot to `/tmp/mcat-pull-<pid>-prod.db` on the VPS.
- It rsyncs it to the Mac at `data/remote/prod.db`.
- It deletes the VPS temp file.

So **no backups are retained on the VPS** unless you maintain them separately. Any such retention schedule or directory is **unverified**.

### Restoring from a backup

This is standard SQLite practice; the project does not ship a restore script.

```sh
ssh vps
pm2 stop mcat mcat-demo
cp /your/backup/mcat-YYYY-MM-DD.db /root/repos/mcat/data/mcat.db
rm -f /root/repos/mcat/data/mcat.db-wal /root/repos/mcat/data/mcat.db-shm
pm2 start mcat mcat-demo
```

> **Production data:** Restoring replaces the live database. Stop both `pm2` processes first. Deleting the old `-wal`/`-shm` files avoids journal mismatches because the backup file is a self-contained snapshot.

---

## 6. Troubleshooting

These are the failure modes explicitly recorded in the source docs and the live `app/api/tool/route.ts`.

### Tuner reads local data, not the VPS

**Symptom:** `docs/tuning/proposal-*.md` says "No questions attempted today" while the VPS has transcripts.
**Cause:** the live `com.mcat.tune` job currently runs `npm run tune` from `/path/to/mcat` against the local `data/mcat.db`.
**Fix:** after `feat/tuner-pipeline` is merged and deployed, the job should run `npm run pull && npm run combine && MCAT_DB=data/combined.db npm run tune`.

### `data_table` fails to render

**Symptom:** The model says the interface hiccupped; curriculum overview does not display.
**Cause:** `lib/views.ts:68` caps `data_table` at 30 rows, but the taxonomy has 34 categories. The view schema rejects the payload.
**Fix:** raise the cap to 60 and instruct the model to split tables by section. This is Task 1 of the implementation plan and exists on the feature branches.

### `/api/tool` swallows tool errors

**Symptom:** The model narrates a failure, but the server logs show nothing.
**Cause:** `app/api/tool/route.ts:23` catches every dispatch error and returns `{error: ...}` with no `console.error` or persistence. This is why real failures leave no server-side trace.
**Fix:** WS-4 in the spec adds a `tool_errors` table and logs only the tool name, message, and arg **keys** (never values, because question stems and `studentReasoning` are sensitive and pm2 logs are plaintext).

### Demo captures bystander room audio

**Symptom:** Demo transcripts contain conversations that are not student study sessions.
**Cause:** `mcatdemo.illinihunt.org` is public and the mic is always hot.
**Mitigation:** the planned combine filters instruction-tuning inputs (`results`, `episodes`, `transcripts`) to `source='prod'` so demo dialogue is not used to tune the examiner. Demo `tool_errors` and `feedback` still count.

### Tuner uses the wrong date window

**Symptom:** Nightly proposal is empty or partial even though the UTC calendar day has data.
**Cause:** 23:00 US Central is 04:00 UTC the next day. A query on `date(ts) = date('now')` asks for the wrong day every night.
**Fix:** the updated `nightly-tune.ts` on `feat/tuner-pipeline` uses `ts >= datetime('now','-24 hours')`.

### Same feedback re-proposes every night

**Symptom:** The same 4 feedback items appear in every proposal.
**Cause:** `data/combined.db` is rebuilt from scratch nightly, so any `feedback.status` written there evaporates.
**Fix:** the updated tuner pushes `feedback.status = 'proposed'` back to the origin VPS databases after the proposal file is written.

### `tool_errors` table is missing

**Symptom:** After deploying WS-4, no `tool_errors` rows appear.
**Cause:** the table is created by `openDb()` on first run after the schema change is deployed. The combine script gracefully skips it until then.
**Fix:** `pm2 restart` the instances so `openDb()` runs against each DB once. The first run after deploy creates the table.

### Sentry is not reporting

**Symptom:** Client crashes or API 500s are invisible.
**Cause:** `SENTRY_DSN` is not set for the SDK, or `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are missing for the nightly fetch.
**Fix:**
- For the Sentry SDK: set `SENTRY_DSN`. The SDK is inert without it.
- For the nightly Sentry fetch (`scripts/fetch-sentry.ts`): set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`. All three are required; if any is missing the fetch returns null and the proposal renders `(Sentry unavailable)` by design, so a Sentry outage cannot stale the tune sentinel.
- The SDK must strip request bodies because `/api/tool` receives question stems and `studentReasoning`.

### Prod `results` table is empty

**Symptom:** `results` has 0 rows on prod despite 32 transcripts.
**Cause:** this is **not** a broken write path. Reviewing the transcripts showed no student ever answered a question to completion. Whether `record_result` persists correctly under real use is still **unverified**.

---

## 7. Unverified items

The following are either not documented in the repo or could not be verified from the allowed source files:

1. **VPS `pm2` start command / ecosystem file** — the exact `pm2` invocation that sets `PORT=3007`/`3008` and `MCAT_DB=data/mcat.db`/`data/demo.db` is not in this repo.
2. **Persistent backup directory on the VPS** — no scheduled backup location or retention policy is defined in the repo; `pull-remote.sh` uses `/tmp` and deletes the snapshot.
3. **Restore procedure details** — the project does not ship a restore script; the commands above are standard SQLite practice.
4. **`record_result` write path under real prod use** — prod has 0 results because no question was completed, so the real write path is untested.
5. **Status of `feat/tuner-pipeline` merge** — the full `pull -> combine -> tune` pipeline is implemented on that branch but not yet merged to `main`/deployed to the VPS.
6. **`docs/superpowers/plans/2026-08-11-tuning-loop-and-interfaces.md` in this checkout** — the file does not exist on `docs/operations-runbook`; it was read from the `feat/tuner-pipeline` branch.
