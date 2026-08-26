#!/usr/bin/env node
// CLI for the local notes app. Usage:
//   node cli.js add "your note text"
//   node cli.js list
//   node cli.js sync

import { listNotes, addNote, markSynced } from "./db.js";

const command = process.argv[2];
const args = process.argv.slice(3);

async function fetchQuoteOfDay() {
  // Fetch a simple JSON payload from a public, no-auth API to demonstrate optional external dependency
  try {
    const res = await fetch("https://api.github.com/zen");
    const text = await res.text();
    return `[GitHub Zen] ${text}`;
  } catch (err) {
    return "[External sync failed - running offline]";
  }
}

switch (command) {
  case "add":
    if (args.length === 0) {
      console.error("Usage: node cli.js add \"note text\"");
      process.exit(1);
    }
    const text = args.join(" ");
    const note = addNote(text);
    console.log(`Added note #${note.id}: "${note.text}"`);
    break;

  case "list":
    const notes = listNotes();
    if (notes.length === 0) {
      console.log("No notes yet.");
    } else {
      console.log("Notes:");
      for (const note of notes) {
        const syncStatus = note.synced_at ? " [synced]" : "";
        console.log(`  #${note.id}: ${note.text}${syncStatus}`);
        console.log(`    created: ${note.created_at}`);
      }
    }
    break;

  case "sync":
    const allNotes = listNotes();
    const unsynced = allNotes.filter((n) => !n.synced_at);
    if (unsynced.length === 0) {
      console.log("All notes already synced.");
      break;
    }
    console.log(`Syncing ${unsynced.length} note(s)...`);
    const message = await fetchQuoteOfDay();
    console.log(`Fetched: ${message}`);
    for (const note of unsynced) {
      markSynced(note.id);
      console.log(`  Synced note #${note.id}`);
    }
    console.log("Sync complete.");
    break;

  default:
    console.error("Usage: node cli.js <command>");
    console.error("Commands: add, list, sync");
    process.exit(1);
}
