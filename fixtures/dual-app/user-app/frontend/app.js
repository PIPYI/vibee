// User-app frontend: submit and view listings (with admin's approval status).

const listEl = document.getElementById("listings-list");
const formEl = document.getElementById("listing-form");
const inputEl = document.getElementById("title-input");

async function loadListings() {
  const res = await fetch("/api/listings");
  const listings = await res.json();
  listEl.innerHTML = "";
  for (const listing of listings) {
    const li = document.createElement("li");
    const statusClass = listing.status === "pending" ? "pending" : listing.status === "approved" ? "approved" : "rejected";
    li.innerHTML = `
      <strong>${listing.title}</strong>
      <span class="status ${statusClass}">${listing.status}</span>
      ${listing.approved_at ? `<br /><small>Approved: ${listing.approved_at}</small>` : ""}
    `;
    listEl.appendChild(li);
  }
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = inputEl.value.trim();
  if (!title) return;
  await fetch("/api/listings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  inputEl.value = "";
  await loadListings();
});

loadListings();
