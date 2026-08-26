# sample-app

A tiny note-taking app: a static HTML/JS frontend that calls a small Express
backend, which persists notes to a local SQLite file (via Node's built-in
`node:sqlite`).

This exists purely as a smoke-test fixture for `vibee`'s architecture-view
pipeline (see `docs/v1_plan.md` §5) — a small, real, freshly-authored
frontend→backend→database project for the AI to point at and analyze. It is
not a real product and is intentionally kept to a handful of files.

It is a standalone project (its own `backend/package.json`, not part of the
vibee npm workspaces) — run `npm install && npm start` inside `backend/` to
try it.
