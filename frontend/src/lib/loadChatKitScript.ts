const CHATKIT_SCRIPT_ID = "openai-chatkit-script";
// Must be loaded from OpenAI's CDN, NOT proxied same-origin. ChatKit derives its
// iframe URL from the directory of its own <script> src (document.currentScript).
// Serving this from our origin (e.g. "/chatkit.js") makes the iframe resolve to
// "<our-origin>/index-*.html", which the SPA fallback answers with our own
// index.html — so the app embeds itself recursively ("multiple frames").
const CHATKIT_SCRIPT_SRC =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";

export function loadChatKitScript() {
  if (
    customElements.get("openai-chatkit") ||
    document.getElementById(CHATKIT_SCRIPT_ID)
  ) {
    return;
  }

  const script = document.createElement("script");
  script.id = CHATKIT_SCRIPT_ID;
  script.src = CHATKIT_SCRIPT_SRC;
  script.async = true;
  script.onerror = () => {
    console.error("Failed to load ChatKit script");
  };
  document.head.append(script);
}
