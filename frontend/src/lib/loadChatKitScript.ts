const CHATKIT_SCRIPT_ID = "openai-chatkit-script";
const CHATKIT_SCRIPT_SRC = "/chatkit.js";

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
    console.error(`Failed to load ChatKit script from ${CHATKIT_SCRIPT_SRC}`);
  };
  document.head.append(script);
}
