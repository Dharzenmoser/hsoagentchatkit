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
    return undefined;
  }
  return id;
})();

export const apiBase = (() => {
  const base =
    readEnvString(import.meta.env.VITE_API_BASE) ??
    readEnvString(import.meta.env.VITE_API_URL);
  return base && !isPlaceholder(base) ? base.replace(/\/+$/, "") : "";
})();

export type ClientSecretFetchEvent =
  | {
      type: "session_reused";
      endpoint: string;
      workflowId?: string;
      workflowSource: "frontend" | "backend";
    }
  | {
      type: "session_request_started";
      endpoint: string;
      workflowId?: string;
      workflowSource: "frontend" | "backend";
    }
  | {
      type: "session_request_succeeded";
      endpoint: string;
      workflowId?: string;
      workflowSource: "frontend" | "backend";
      expiresAfter?: unknown;
    }
  | {
      type: "session_request_failed";
      endpoint: string;
      workflowId?: string;
      workflowSource: "frontend" | "backend";
      status?: number;
      error: string;
    };

export function createClientSecretFetcher(
  workflow?: string,
  endpoint = `${apiBase}/api/create-session`,
  onEvent?: (event: ClientSecretFetchEvent) => void
) {
  const workflowSource = workflow ? "frontend" : "backend";

  return async (currentSecret: string | null) => {
    if (currentSecret) {
      onEvent?.({
        type: "session_reused",
        endpoint,
        workflowId: workflow,
        workflowSource,
      });
      return currentSecret;
    }

    const body = workflow ? { workflow: { id: workflow } } : {};
    onEvent?.({
      type: "session_request_started",
      endpoint,
      workflowId: workflow,
      workflowSource,
    });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reach session backend";
      onEvent?.({
        type: "session_request_failed",
        endpoint,
        workflowId: workflow,
        workflowSource,
        error: message,
      });
      throw new Error(message);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      client_secret?: string;
      expires_after?: unknown;
      workflow_id?: unknown;
      error?: unknown;
      message?: unknown;
    };

    if (!response.ok) {
      const message = sessionErrorMessage(payload, response.status);
      onEvent?.({
        type: "session_request_failed",
        endpoint,
        workflowId: workflow,
        workflowSource,
        status: response.status,
        error: message,
      });
      throw new Error(message);
    }

    if (!payload.client_secret) {
      const message = "Missing client secret in response";
      onEvent?.({
        type: "session_request_failed",
        endpoint,
        workflowId: workflow,
        workflowSource,
        status: response.status,
        error: message,
      });
      throw new Error(message);
    }

    onEvent?.({
      type: "session_request_succeeded",
      endpoint,
      workflowId: readEnvString(payload.workflow_id) ?? workflow,
      workflowSource,
      expiresAfter: payload.expires_after,
    });

    return payload.client_secret;
  };
}

function sessionErrorMessage(
  payload: { error?: unknown; message?: unknown },
  status: number
) {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  return `Failed to create session (HTTP ${status})`;
}
