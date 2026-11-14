import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, readTheme, watchStatusBar } from "./ui";
import "./index.css";

applyTheme(readTheme(), false);
watchStatusBar();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
