# local-notes-cli

A minimal local-first CLI note tracker: keeps notes in a local SQLite database
(via Node's built-in `node:sqlite`) and optionally syncs them by fetching a
simple public API (GitHub's Zen endpoint, which requires no authentication).

This exists as a smoke-test fixture for `vibee`'s architecture-view pipeline —
a small, real CLI tool demonstrating a single-runtime, local-first pattern with
an optional external dependency.

## Usage

```bash
npm install
node cli.js add "buy milk"
node cli.js list
node cli.js sync
```

Commands:
- `add <text>`: Create a new note locally
- `list`: Show all notes (marking which are synced)
- `sync`: Fetch an external API and mark unsynced notes as synced
