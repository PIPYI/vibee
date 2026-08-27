// Shared SQLite database for both user-app and admin-app.
// They both read/write the same "listings" table.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "listings.db");

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    approved_at TEXT
  )
`);

export function createListing(title) {
  const createdAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO listings (title, status, created_at) VALUES (?, ?, ?)")
    .run(title, "pending", createdAt);
  return {
    id: Number(result.lastInsertRowid),
    title,
    status: "pending",
    created_at: createdAt,
    approved_at: null,
  };
}

export function listListings() {
  return db.prepare("SELECT * FROM listings ORDER BY id DESC").all();
}

export function getListingById(id) {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
}

export function approveListing(id) {
  const approvedAt = new Date().toISOString();
  db.prepare("UPDATE listings SET status = 'approved', approved_at = ? WHERE id = ?").run(
    approvedAt,
    id
  );
}

export function rejectListing(id) {
  db.prepare("UPDATE listings SET status = 'rejected' WHERE id = ?").run(id);
}
