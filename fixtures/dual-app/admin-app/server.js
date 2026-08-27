// Admin-app: lets admins approve/reject listings.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listListings, approveListing, rejectListing } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

app.get("/api/listings", (_req, res) => {
  res.json(listListings());
});

app.post("/api/listings/:id/approve", (req, res) => {
  approveListing(Number(req.params.id));
  res.json({ status: "approved" });
});

app.post("/api/listings/:id/reject", (req, res) => {
  rejectListing(Number(req.params.id));
  res.json({ status: "rejected" });
});

const port = process.env.PORT || 3501;
app.listen(port, () => {
  console.log(`Admin-app listening on http://127.0.0.1:${port}`);
});
