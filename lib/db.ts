import Database from 'better-sqlite3';

export const DEFAULT_DB_PATH = process.env.MCAT_DB ?? 'data/mcat.db';

export function openDb(path: string = DEFAULT_DB_PATH) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories(
      id TEXT PRIMARY KEY, section TEXT NOT NULL, name TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      mastery REAL NOT NULL DEFAULT 0.5, attempts INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NULL, interval_days REAL NOT NULL DEFAULT 1);
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
    CREATE TABLE IF NOT EXISTS episodes(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')),
      category_id TEXT NOT NULL, stem TEXT NOT NULL, options_json TEXT NOT NULL,
      correct_index INT NOT NULL, chosen_index INT NOT NULL, error_type TEXT,
      misconception TEXT, student_reasoning TEXT, embedding BLOB NULL);
    CREATE TABLE IF NOT EXISTS transcripts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      role TEXT NOT NULL CHECK(role IN ('user','bot','system')), text TEXT NOT NULL);
  `);

  const categoryColumns = db.pragma('table_info(categories)') as { name: string }[];
  const categoryColumnNames = new Set(categoryColumns.map(({ name }) => name));
  if (!categoryColumnNames.has('due_at')) {
    db.exec('ALTER TABLE categories ADD COLUMN due_at TEXT NULL');
  }
  if (!categoryColumnNames.has('interval_days')) {
    db.exec('ALTER TABLE categories ADD COLUMN interval_days REAL NOT NULL DEFAULT 1');
  }
  return db;
}

export type DB = ReturnType<typeof openDb>;
