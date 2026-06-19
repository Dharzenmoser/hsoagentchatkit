import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadChatKitScript } from "./lib/loadChatKitScript";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element with id 'root' not found");
}

loadChatKitScript();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);



