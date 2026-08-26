import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listNotes, createNote } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/api/notes", (_req, res) => {
  res.json(listNotes());
});

app.post("/api/notes", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (text.length === 0) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  res.status(201).json(createNote(text));
});

const port = process.env.PORT || 3300;
app.listen(port, () => {
  console.log(`sample-app backend listening on http://127.0.0.1:${port}`);
});
