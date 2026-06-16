import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const domainKey = process.env.API_DOMAIN_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!domainKey || !openaiKey) {
    return res.status(500).json({ error: "Missing server configuration" });
  }

  const client = new ChatKit({ domain: "harzi.app" });

  const { workflow } = req.body as { workflow: { id: string } };

  const response = await fetch("https://api.openai.com/v1/chatkit/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain_key: domainKey,   // ← API_DOMAIN_KEY aus Vercel Env
      workflow_id: workflow.id,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return res.status(response.status).json({ error: data.error ?? "OpenAI error" });
  }

  return res.status(200).json({ client_secret: data.client_secret });
}