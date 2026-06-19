import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId, apiBase } from "../lib/chatkitSession";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const DOCUMENT_ACCEPT = {
  "application/json": [".json"],
  "application/msword": [".doc"],
  "application/pdf": [".pdf"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/csv": [".csv"],
  "text/markdown": [".md"],
  "text/plain": [".txt"],
} satisfies Record<string, string[]>;

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
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
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
  const [agentError, setAgentError] = useState<string | null>(null);

  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    composer: {
      attachments: {
        enabled: true,
        accept: DOCUMENT_ACCEPT,
        maxCount: MAX_ATTACHMENTS,
        maxSize: MAX_DOCUMENT_BYTES,
      },
    },
    onError: (detail) => {
      setAgentError(detail.error?.message ?? "Unbekannter Fehler vom Agenten");
    },
  });

  return (
    <div className="flex min-h-0 flex-1 w-full flex-col gap-3">

      <div className="shrink-0">
        <ConnectionBanner />
      </div>

      {agentError && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-red-50 px-4 py-3 text-sm dark:bg-red-900/20">
          <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{agentError}</span>
          </div>
          {agentError.toLowerCase().includes("domain") && (
            <p className="pl-5 text-xs text-red-500 dark:text-red-500">
              Hinweis: Füge die aktuelle App-Domain in den erlaubten Domains deines Workflows im OpenAI Agent Builder hinzu.
            </p>
          )}
          {(agentError.includes("401") || agentError.toLowerCase().includes("unauthorized")) && !agentError.toLowerCase().includes("domain") && (
            <p className="pl-5 text-xs text-red-500 dark:text-red-500">
              Hinweis: Prüfe ob <code className="rounded bg-red-100 px-1 dark:bg-red-900/40">OPENAI_API_KEY</code> und <code className="rounded bg-red-100 px-1 dark:bg-red-900/40">VITE_CHATKIT_WORKFLOW_ID</code> korrekt gesetzt sind.
            </p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 rounded-2xl overflow-hidden shadow-sm">
        <ErrorBoundary>
          <ChatKit control={chatkit.control} className="h-full w-full" />
        </ErrorBoundary>
      </div>

    </div>
  );
}
