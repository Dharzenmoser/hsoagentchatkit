import { useEffect, useMemo, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

type ConnectionStatus = "checking" | "ok" | "error";

function ConnectionBanner() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow: { id: workflowId } }),
        });

        const payload = await res.json().catch(() => ({})) as {
          client_secret?: string;
          error?: string;
        };

        if (cancelled) return;

        if (!res.ok) {
          setStatus("error");
          setDetail(payload.error ?? `HTTP ${res.status}`);
        } else if (!payload.client_secret) {
          setStatus("error");
          setDetail("Missing client_secret in response");
        } else {
          setStatus("ok");
          setDetail("Backend & OpenAI erreichbar");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setDetail(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const base =
    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium";

  if (status === "checking") {
    return (
      <div className={`${base} bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
        Verbindung wird geprüft…
      </div>
    );
  }

  if (status === "ok") {
    return (
      <div className={`${base} bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400`}>
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Verbunden — {detail}
      </div>
    );
  }

  return (
    <div className={`${base} bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400`}>
      <span className="h-2 w-2 rounded-full bg-red-500" />
      Verbindungsfehler: {detail}
    </div>
  );
}

export function ChatKitPanel() {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: {
      getClientSecret,
    },
    composer: {
      attachments: {
        enabled: true,
        accept: {
          "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
          "application/pdf": [".pdf"],
          "text/plain": [".txt"],
          "text/markdown": [".md"],
          "application/msword": [".doc"],
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
            ".docx",
          ],
        },
        maxCount: 5,
        maxSize: 20 * 1024 * 1024, // 20 MB
      },
    },
  });

  return (
    <div className="flex w-full flex-col gap-2">
      <ConnectionBanner />
      <div className="flex h-[90vh] w-full rounded-2xl bg-white shadow-sm transition-colors dark:bg-slate-900">
        <ChatKit control={chatkit.control} className="h-full w-full" />
      </div>
    </div>
  );
}
