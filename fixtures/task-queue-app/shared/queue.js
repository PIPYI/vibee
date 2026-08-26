// Shared queue implementation using SQLite, accessed by both producer and worker.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "queue.db");

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    processed_at TEXT,
    result TEXT
  )
`);

export function enqueueJob(title) {
  const createdAt = new Date().toISOString();
  const result = db.prepare("INSERT INTO jobs (title, status, created_at) VALUES (?, ?, ?)").run(
    title,
    "pending",
    createdAt
  );
  return { id: Number(result.lastInsertRowid), title, status: "pending", created_at: createdAt };
}

export function getJob(jobId) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
}

export function getPendingJob() {
  // Get the oldest pending job
  return db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get();
}

export function updateJobStatus(jobId, status, result = null) {
  const processedAt = new Date().toISOString();
  db.prepare("UPDATE jobs SET status = ?, processed_at = ?, result = ? WHERE id = ?").run(
    status,
    processedAt,
    result,
    jobId
  );
}

export function listJobs() {
  return db.prepare("SELECT * FROM jobs ORDER BY id DESC").all();
}
