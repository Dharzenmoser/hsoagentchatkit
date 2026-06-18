import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    return res.status(500).json({ error: "Missing server configuration" });
  }

  const workflowId = resolveWorkflowId(req.body) ?? process.env.CHATKIT_WORKFLOW_ID;
  if (!workflowId || !workflowId.startsWith("wf_")) {
    return res.status(400).json({ error: "Invalid or missing workflow id" });
  }

  const user = req.cookies.chatkit_session_id ?? crypto.randomUUID();

  const response = await fetch("https://api.openai.com/v1/chatkit/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "OpenAI-Beta": "chatkit_beta=v1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workflow: { id: workflowId },
      user,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return res.status(response.status).json({ error: data.error ?? "OpenAI error" });
  }

  res.setHeader("Set-Cookie", `chatkit_session_id=${user}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return res.status(200).json({ client_secret: data.client_secret });
}

function resolveWorkflowId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const payload = body as {
    workflow?: { id?: unknown };
    workflowId?: unknown;
    workflow_id?: unknown;
  };
  const value = payload.workflow?.id ?? payload.workflowId ?? payload.workflow_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
