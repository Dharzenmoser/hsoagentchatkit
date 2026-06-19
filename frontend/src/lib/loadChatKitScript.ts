import { apiBase } from "./chatkitSession";

const CHATKIT_SCRIPT_ID = "openai-chatkit-script";
const CHATKIT_SCRIPT_PATH = "/chatkit.js";
const CHATKIT_CDN_SRC = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";

function getChatKitScriptSrc() {
  return apiBase ? `${apiBase}${CHATKIT_SCRIPT_PATH}` : CHATKIT_SCRIPT_PATH;
}

function appendChatKitScript(src: string, allowFallback = true) {
  const script = document.createElement("script");
  script.id = CHATKIT_SCRIPT_ID;
  script.src = src;
  script.async = true;
  script.onerror = () => {
    console.error(`Failed to load ChatKit script from ${src}`);
    if (allowFallback && src !== CHATKIT_CDN_SRC) {
      script.remove();
      appendChatKitScript(CHATKIT_CDN_SRC, false);
    }
  };
  document.head.append(script);
}

export function loadChatKitScript() {
  if (
    customElements.get("openai-chatkit") ||
    document.getElementById(CHATKIT_SCRIPT_ID)
  ) {
    return;
  }

  appendChatKitScript(getChatKitScriptSrc());
}
