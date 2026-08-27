# task-queue-app

A minimal producer/worker queue system: an Express server accepts job requests,
enqueues them in a local SQLite database (via Node's built-in `node:sqlite`),
and a separate worker process polls the queue, processes jobs, and writes
results to a local file (simulating an external side effect).

This exists as a smoke-test fixture for `vibee`'s architecture-view pipeline —
demonstrating a multi-process, work-distribution pattern with a shared data
store and an external side effect.

## Usage

Terminal 1 (Producer):
```bash
npm install
node producer/server.js
```

Terminal 2 (Worker):
```bash
node worker/worker.js
```

Terminal 3 (Submit jobs):
```bash
curl -X POST http://127.0.0.1:3400/jobs -H "content-type: application/json" -d '{"title":"buy milk"}'
curl http://127.0.0.1:3400/jobs
```

The worker will pick up jobs from the queue and process them, marking each as
completed in the database and appending a result line to `results.txt`.
