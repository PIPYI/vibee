// Producer: an Express server that accepts job requests and enqueues them.
import express from "express";
import { enqueueJob, getJob, listJobs } from "../shared/queue.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Task Queue Producer Server" });
});

app.post("/jobs", (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (title.length === 0) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const job = enqueueJob(title);
  res.status(201).json(job);
});

app.get("/jobs", (_req, res) => {
  const jobs = listJobs();
  res.json(jobs);
});

app.get("/jobs/:id", (req, res) => {
  const job = getJob(Number(req.params.id));
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  res.json(job);
});

const port = process.env.PORT || 3400;
app.listen(port, () => {
  console.log(`Producer listening on http://127.0.0.1:${port}`);
});
