import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div className="p-4 text-red-700 text-sm">
          <strong>Fehler:</strong> {err.message}
          <pre className="mt-2 text-xs whitespace-pre-wrap">{err.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type Status = "checking" | "ok" | "error";

function ConnectionBanner() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/health").then(res => {
      if (!cancelled) {
        if (res.ok) { setStatus("ok"); setDetail("Backend erreichbar"); }
        else { setStatus("error"); setDetail(`HTTP ${res.status}`); }
      }
    }).catch(err => {
      if (!cancelled) { setStatus("error"); setDetail(String(err)); }
    });
    return () => { cancelled = true; };
  }, []);

  const color = { checking: "text-slate-400", ok: "text-green-600", error: "text-red-600" }[status];
  const dot = { checking: "bg-slate-400 animate-pulse", ok: "bg-green-500", error: "bg-red-500" }[status];
  const text = { checking: "Verbindung wird geprüft…", ok: `Verbunden — ${detail}`, error: `Fehler: ${detail}` }[status];

  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b border-slate-100 dark:border-slate-800 ${color}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
      {text}
    </div>
  );
}

export function ChatKitPanel() {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
  });

  return (
    <div className="flex min-h-0 flex-1 w-full flex-col rounded-2xl bg-white shadow-sm dark:bg-slate-900 overflow-hidden">
      <ConnectionBanner />
      <div className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary>
          <ChatKit control={chatkit.control} className="h-full w-full" />
        </ErrorBoundary>
      </div>
    </div>
  );
}
