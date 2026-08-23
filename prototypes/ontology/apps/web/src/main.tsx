import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Shell } from "./Shell.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
