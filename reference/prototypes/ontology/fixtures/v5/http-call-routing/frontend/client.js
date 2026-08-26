const BASE = "";

export async function loadItem(id) {
  return fetch(`${BASE}/x/${id}`);
}

export async function loadExternalItem() {
  return fetch("https://example.com/x/42");
}
