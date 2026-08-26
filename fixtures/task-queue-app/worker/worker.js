// Worker: polls the queue and processes jobs.
// A job here is "processed" by writing a record to a local results file (simulating an external side effect like sending email).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPendingJob, updateJobStatus } from "../shared/queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsFile = path.join(__dirname, "..", "results.txt");

// Simulated external side effect: "send" a result by appending to a file
function sendResult(jobId, title) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] Job #${jobId}: ${title}\n`;
  fs.appendFileSync(resultsFile, line);
  return `sent to results.txt`;
}

async function processJob() {
  const job = getPendingJob();
  if (!job) {
    console.log("No pending jobs.");
    return false;
  }

  console.log(`Processing job #${job.id}: "${job.title}"`);
  const result = sendResult(job.id, job.title);
  updateJobStatus(job.id, "completed", result);
  console.log(`  Completed: ${result}`);
  return true;
}

async function run() {
  console.log("Worker starting... (polling every 2 seconds)");
  // Process one job then wait
  const hasWork = await processJob();
  if (hasWork) {
    // After processing, check again in 2 seconds
    setTimeout(run, 2000);
  } else {
    // No work, but keep polling
    setTimeout(run, 2000);
  }
}

// For testing: run once and exit if there's work, or run forever in the background
const singleRun = process.argv.includes("--once");
if (singleRun) {
  await processJob();
  process.exit(0);
} else {
  run();
}
