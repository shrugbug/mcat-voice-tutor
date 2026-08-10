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

export type DB = ReturnType<typeof openDb>;
