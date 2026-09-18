import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { applyInitialTheme } from "./theme/useTheme.ts";

// Apply the stored theme synchronously before React mounts so the
// first paint matches the user's preference (no flash of light mode
// when they want dark).
applyInitialTheme();

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
