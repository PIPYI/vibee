// Admin-app frontend: approve/reject listings.

const container = document.getElementById("listings-container");

async function loadListings() {
  const res = await fetch("/api/listings");
  const listings = await res.json();
  container.innerHTML = "";
  for (const listing of listings) {
    const div = document.createElement("div");
    div.className = "listing";
    const statusClass = listing.status === "pending" ? "pending" : listing.status === "approved" ? "approved" : "rejected";
    div.innerHTML = `
      <strong>${listing.title}</strong>
      <span class="status ${statusClass}">${listing.status}</span>
      <br />
      <small>${listing.created_at}</small>
      ${
        listing.status === "pending"
          ? `<button onclick="approve(${listing.id})">Approve</button>
             <button onclick="reject(${listing.id})">Reject</button>`
          : ""
      }
    `;
    container.appendChild(div);
  }
}

window.approve = async (id) => {
  await fetch(`/api/listings/${id}/approve`, { method: "POST" });
  await loadListings();
};

window.reject = async (id) => {
  await fetch(`/api/listings/${id}/reject`, { method: "POST" });
  await loadListings();
};

loadListings();
// Reload every 5 seconds to show updates from user app
setInterval(loadListings, 5000);
