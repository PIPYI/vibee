// Tiny client for the sample-app fixture: fetches notes from the backend's
// REST API and lets the user add new ones.

const listEl = document.getElementById("notes-list");
const formEl = document.getElementById("new-note-form");
const inputEl = document.getElementById("note-text");

async function loadNotes() {
  const res = await fetch("/api/notes");
  const notes = await res.json();
  listEl.innerHTML = "";
  for (const note of notes) {
    const li = document.createElement("li");
    li.textContent = note.text;
    listEl.appendChild(li);
  }
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  inputEl.value = "";
  await loadNotes();
});

loadNotes();
