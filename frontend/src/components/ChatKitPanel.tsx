import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

// --- Error Boundary ---

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full items-center justify-center rounded-2xl bg-red-50 p-6 dark:bg-red-900/20">
          <div className="max-w-lg space-y-2">
            <p className="font-semibold text-red-700 dark:text-red-400">Fehler beim Laden des Chat-UI</p>
            <pre className="overflow-auto rounded bg-red-100 p-3 text-xs text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Connection Banner ---

type ConnectionStatus = "checking" | "ok" | "error";

function ConnectionBanner() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/health");
        if (cancelled) return;
        if (res.ok) {
          setStatus("ok");
          setDetail("Backend erreichbar");
        } else {
          setStatus("error");
          setDetail(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setDetail(err instanceof Error ? err.message : "Keine Verbindung zum Backend");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const styles: Record<ConnectionStatus, string> = {
    checking: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    ok:       "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    error:    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  const dot: Record<ConnectionStatus, string> = {
    checking: "bg-slate-400 animate-pulse",
    ok:       "bg-green-500",
    error:    "bg-red-500",
  };

  const label: Record<ConnectionStatus, string> = {
    checking: "Verbindung wird geprüft…",
    ok:       `Verbunden — ${detail}`,
    error:    `Verbindungsfehler: ${detail}`,
  };

  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${styles[status]}`}>
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {label[status]}
    </div>
  );
}

// --- Main Panel ---

export function ChatKitPanel() {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    composer: {
      attachments: { enabled: false },
    },
  });

  return (
    <div className="flex min-h-0 flex-1 w-full flex-col rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
        <ConnectionBanner />
      </div>
      <div className="flex min-h-0 flex-1">
        <ErrorBoundary>
          <ChatKit control={chatkit.control} className="h-full w-full" />
        </ErrorBoundary>
      </div>
    </div>
  );
}
