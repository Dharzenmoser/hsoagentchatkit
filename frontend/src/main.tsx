import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadChatKitScript } from "./lib/loadChatKitScript";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element with id 'root' not found");
}

loadChatKitScript();

// NOTE: Do NOT wrap <App /> in <StrictMode>. The ChatKit web component is
// initialized in a useLayoutEffect whose cleanup does not tear the widget down,
// so StrictMode's dev-only setup→cleanup→setup cycle mounts a second
// <openai-chatkit> iframe ("multiple frames"). Rendering once avoids the dupe.
createRoot(container).render(<App />);



