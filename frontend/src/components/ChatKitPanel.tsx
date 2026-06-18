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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);

  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    composer: { attachments: { enabled: false } },
    onResponseStart: () => setIsResponding(true),
    onResponseEnd: () => {
      setIsResponding(false);
      setHasMessages(true);
    },
  });

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await chatkit.sendUserMessage({ text });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: { key: string; shiftKey: boolean; preventDefault: () => void }) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 w-full gap-4">

      {/* Left: Input Panel */}
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          <ConnectionBanner />
        </div>

        <div className="flex flex-1 flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Nachricht senden
          </p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Frage oder Dokument eingeben…"
            disabled={sending}
            rows={6}
            className="w-full flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-full rounded-xl bg-slate-800 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {sending ? "Wird gesendet…" : "Senden"}
          </button>
        </div>
      </div>

      {/* Right: Answer Panel */}
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white shadow-sm dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Agent Antwort
          </span>
          {isResponding && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
              Agent antwortet…
            </span>
          )}
        </div>

        {!hasMessages && !isResponding ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            Sende eine Nachricht, um die Antwort des Agenten zu sehen.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 chatkit-no-composer">
            <ErrorBoundary>
              <ChatKit control={chatkit.control} className="h-full w-full" />
            </ErrorBoundary>
          </div>
        )}
      </div>

    </div>
  );
}
