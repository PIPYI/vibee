// Local SQLite persistence for the notes CLI, using Node's built-in node:sqlite.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "notes.db");

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT
  )
`);

export function listNotes() {
  return db.prepare("SELECT id, text, created_at, synced_at FROM notes ORDER BY id DESC").all();
}

export function addNote(text) {
  const createdAt = new Date().toISOString();
  const result = db.prepare("INSERT INTO notes (text, created_at) VALUES (?, ?)").run(text, createdAt);
  return { id: Number(result.lastInsertRowid), text, created_at: createdAt, synced_at: null };
}

export function markSynced(noteId) {
  const syncedAt = new Date().toISOString();
  db.prepare("UPDATE notes SET synced_at = ? WHERE id = ?").run(syncedAt, noteId);
}
