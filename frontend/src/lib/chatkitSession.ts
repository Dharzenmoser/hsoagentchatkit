const readEnvString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const isPlaceholder = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    normalized === "replace_me" ||
    normalized.startsWith("replace_me_") ||
    normalized.startsWith("wf_replace")
  );
};

export const workflowId = (() => {
  const id = readEnvString(import.meta.env.VITE_CHATKIT_WORKFLOW_ID);
  if (!id || isPlaceholder(id) || !id.startsWith("wf_")) {
    throw new Error("Set VITE_CHATKIT_WORKFLOW_ID in your .env file.");
  }
  return id;
})();

export const apiBase = (() => {
  const base =
    readEnvString(import.meta.env.VITE_API_BASE) ??
    readEnvString(import.meta.env.VITE_API_URL);
  return base && !isPlaceholder(base) ? base.replace(/\/+$/, "") : "";
})();

export function createClientSecretFetcher(
  workflow: string,
  endpoint = `${apiBase}/api/create-session`
) {
  return async (currentSecret: string | null) => {
    if (currentSecret) return currentSecret;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: { id: workflow } }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      client_secret?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? `Failed to create session (HTTP ${response.status})`);
    }

    if (!payload.client_secret) {
      throw new Error("Missing client secret in response");
    }

    return payload.client_secret;
  };
}
