import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Attachment } from "@openai/chatkit";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId, apiBase } from "../lib/chatkitSession";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const DEFAULT_INPUT_MESSAGE = "Bitte analysiere diese Dokumente";
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
const DOCUMENT_ACCEPT_ATTRIBUTE = Object.entries(DOCUMENT_ACCEPT)
  .flatMap(([mimeType, extensions]) => [mimeType, ...extensions])
  .join(",");
const DOCUMENT_MIME_TYPES = new Set(Object.keys(DOCUMENT_ACCEPT));
const DOCUMENT_EXTENSIONS = new Set(Object.values(DOCUMENT_ACCEPT).flat());

type UploadedDocument = Extract<Attachment, { type: "file" }>;

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

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657L4.757 11.586a6 6 0 1 0 8.486 8.486L21 12.314" />
    </svg>
  );
}

function getFileExtension(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

function isAllowedDocument(file: File) {
  return (
    (file.type ? DOCUMENT_MIME_TYPES.has(file.type) : false) ||
    DOCUMENT_EXTENSIONS.has(getFileExtension(file.name))
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

async function uploadDocument(file: File): Promise<UploadedDocument> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${file.name} ist groesser als 25 MB.`);
  }
  if (!isAllowedDocument(file)) {
    throw new Error(`${file.name} wird nicht unterstuetzt.`);
  }

  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${apiBase}/api/upload-file`, {
    method: "POST",
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<UploadedDocument> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? `Upload fehlgeschlagen (HTTP ${response.status})`);
  }
  if (
    payload.type !== "file" ||
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.mime_type !== "string"
  ) {
    throw new Error("Upload-Antwort enthaelt keinen gueltigen Dateianhang.");
  }

  return payload;
}

// --- Main Panel ---

export function ChatKitPanel() {
  const [input, setInput] = useState(DEFAULT_INPUT_MESSAGE);
  const [attachments, setAttachments] = useState<UploadedDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    onResponseStart: () => {
      setAgentError(null);
      setIsResponding(true);
    },
    onResponseEnd: () => {
      setIsResponding(false);
      setHasMessages(true);
    },
    onError: (detail) => {
      setIsResponding(false);
      setSending(false);
      setAgentError(detail.error?.message ?? "Unbekannter Fehler vom Agenten");
    },
  });

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setAgentError(`Maximal ${MAX_ATTACHMENTS} Dokumente pro Nachricht.`);
      return;
    }

    setAgentError(null);
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(uploadDocument));
      setAttachments((current) => [...current, ...uploaded]);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Dokument konnte nicht hochgeladen werden");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || uploading) return;
    const attachmentsToSend = attachments;
    const messageText = text || DEFAULT_INPUT_MESSAGE;
    setAgentError(null);
    setSending(true);
    setInput("");
    setAttachments([]);
    try {
      if (attachmentsToSend.length > 0) {
        await chatkit.sendUserMessage({ text: messageText, attachments: attachmentsToSend });
      } else {
        await chatkit.sendUserMessage({ text: messageText });
      }
    } catch (err) {
      setInput(text);
      setAttachments(attachmentsToSend);
      setAgentError(err instanceof Error ? err.message : "Nachricht konnte nicht gesendet werden");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: { key: string; shiftKey: boolean; preventDefault: () => void }) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const canSend = (Boolean(input.trim()) || attachments.length > 0) && !sending && !uploading;
  const showEmptyState = !hasMessages && !isResponding && !sending && !agentError;

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
          <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Frage oder Dokument eingeben…"
            disabled={sending}
            rows={6}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-14 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
          />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={DOCUMENT_ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(event) => {
                void handleFileChange(event);
              }}
            />
            <button
              type="button"
              title="Dokument anhaengen"
              aria-label="Dokument anhaengen"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploading || attachments.length >= MAX_ATTACHMENTS}
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {uploading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-600 dark:border-t-slate-100" />
              ) : (
                <PaperclipIcon />
              )}
            </button>
          </div>

          {(attachments.length > 0 || uploading) && (
            <div className="flex flex-col gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <span className="ml-auto shrink-0 text-slate-400">{attachment.mime_type}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    aria-label={`${attachment.name} entfernen`}
                    title="Entfernen"
                    onClick={() => removeAttachment(attachment.id)}
                    disabled={sending}
                  >
                    x
                  </button>
                </div>
              ))}
              {uploading && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dokument wird hochgeladen...
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 dark:text-slate-500">
            PDF, Word, Excel, PowerPoint, Text, Markdown, CSV oder JSON bis {formatBytes(MAX_DOCUMENT_BYTES)}.
          </p>
          <button
            onClick={() => {
              void handleSend();
            }}
            disabled={!canSend}
            className="w-full rounded-xl bg-slate-800 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {sending ? "Wird gesendet…" : "Senden"}
          </button>
        </div>
      </div>

      {/* Right: Answer Panel */}
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white shadow-sm dark:bg-slate-900">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Agent Antwort
          </span>
          {(isResponding || sending) && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
              {sending ? "Nachricht wird gesendet…" : "Agent antwortet…"}
            </span>
          )}
        </div>

        {/* Error Banner */}
        {agentError && (
          <div className="mx-4 mt-3 flex flex-col gap-1.5 rounded-xl bg-red-50 px-4 py-3 text-sm dark:bg-red-900/20">
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

        {/* ChatKit is always mounted so the session stays connected.
            The empty-state overlay sits on top when there are no messages yet. */}
        <div className="relative flex min-h-0 flex-1">
          {showEmptyState && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-b-2xl bg-white dark:bg-slate-900">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                Sende eine Nachricht, um die Antwort des Agenten zu sehen.
              </p>
            </div>
          )}
          <div className="flex min-h-0 flex-1 chatkit-no-composer">
            <ErrorBoundary>
              <ChatKit control={chatkit.control} className="h-full w-full" />
            </ErrorBoundary>
          </div>
        </div>

      </div>

    </div>
  );
}
