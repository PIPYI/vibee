// User-app: lets users submit and view listings.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createListing, listListings } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

app.get("/api/listings", (_req, res) => {
  res.json(listListings());
});

app.post("/api/listings", (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (title.length === 0) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const listing = createListing(title);
  res.status(201).json(listing);
});

const port = process.env.PORT || 3500;
app.listen(port, () => {
  console.log(`User-app listening on http://127.0.0.1:${port}`);
});
