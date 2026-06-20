import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChatKit,
  useChatKit,
  type HostedApiConfig,
} from "@openai/chatkit-react";
import {
  createClientSecretFetcher,
  workflowId,
  apiBase,
  type ClientSecretFetchEvent,
} from "../lib/chatkitSession";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const DOCUMENT_ACCEPT = {
  "application/csv": [".csv"],
  "application/json": [".json"],
  "application/msword": [".doc"],
  "application/pdf": [".pdf"],
  "application/rtf": [".rtf"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/xml": [".xml"],
  "text/csv": [".csv"],
  "text/html": [".html", ".htm"],
  "text/markdown": [".md"],
  "text/plain": [".txt"],
  "text/rtf": [".rtf"],
  "text/tsv": [".tsv"],
  "text/xml": [".xml"],
} satisfies Record<string, string[]>;

const SESSION_ENDPOINT = `${apiBase}/api/create-session`;

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
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json().catch(() => ({})) as { agent_name?: string };
          if (!cancelled) {
            setStatus("ok");
            setAgentName(body.agent_name ?? null);
            setDetail("Backend erreichbar");
          }
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
    ok:       agentName ? `Verbunden — ${agentName}` : "Verbunden",
    error:    `Verbindungsfehler: ${detail}`,
  };

  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${styles[status]}`}>
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {label[status]}
    </div>
  );
}

type BackendConnection = {
  status: ConnectionStatus;
  detail: string;
  agentName: string | null;
};

type DiagnosticTone = "neutral" | "ok" | "warn" | "error" | "active";

type SessionStatus = "idle" | "requesting" | "ready" | "reused" | "error";

type SessionSnapshot = {
  status: SessionStatus;
  endpoint: string;
  workflowSource: "frontend" | "backend";
  detail: string;
  workflowId?: string;
  statusCode?: number;
  expiresAfter?: unknown;
  updatedAt?: string;
};

type ResponseSnapshot = {
  status: "idle" | "responding" | "complete" | "error";
  detail: string;
  threadId: string | null;
  updatedAt?: string;
};

type DiagnosticEvent = {
  id: number;
  time: string;
  label: string;
  detail: string;
  tone: DiagnosticTone;
};

function useBackendDiagnosticsConnection() {
  const [connection, setConnection] = useState<BackendConnection>({
    status: "checking",
    detail: "",
    agentName: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json().catch(() => ({})) as { agent_name?: string };
          setConnection({
            status: "ok",
            agentName: body.agent_name ?? null,
            detail: "Backend reachable",
          });
        } else {
          setConnection({
            status: "error",
            agentName: null,
            detail: `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setConnection({
            status: "error",
            agentName: null,
            detail: err instanceof Error ? err.message : "No backend connection",
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return connection;
}

function initialSessionSnapshot(): SessionSnapshot {
  return {
    status: "idle",
    endpoint: SESSION_ENDPOINT,
    workflowSource: workflowId ? "frontend" : "backend",
    workflowId,
    detail: workflowId
      ? "Browser will request the configured workflow."
      : "Backend must provide CHATKIT_WORKFLOW_ID.",
  };
}

function initialResponseSnapshot(): ResponseSnapshot {
  return {
    status: "idle",
    detail: "No ChatKit response event yet.",
    threadId: null,
  };
}

function formatDiagnosticTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortValue(value?: string | null) {
  if (!value) return "not known";
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function workflowSourceLabel(source: "frontend" | "backend") {
  return source === "frontend" ? "browser env" : "backend env";
}

function formatExpiresAfter(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return "not provided";
}

function toneClasses(tone: DiagnosticTone) {
  const classes: Record<DiagnosticTone, string> = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
    warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-300",
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300",
    active: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300",
  };
  return classes[tone];
}

function StatusRow({
  title,
  status,
  detail,
  tone,
}: {
  title: string;
  status: string;
  detail: string;
  tone: DiagnosticTone;
}) {
  return (
    <section className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClasses(tone)}`}>
          {status}
        </span>
      </div>
      <p className="text-sm leading-5 text-slate-700 dark:text-slate-200">{detail}</p>
    </section>
  );
}

function sessionRoute(session: SessionSnapshot, response: ResponseSnapshot) {
  if (response.status === "responding") {
    return {
      status: "Agent responding",
      tone: "active" as const,
      detail: `ChatKit emitted response.start for workflow ${shortValue(session.workflowId)}.`,
    };
  }

  if (session.status === "ready" || session.status === "reused") {
    return {
      status: "Agent confirmed",
      tone: "ok" as const,
      detail: `Session is bound to workflow ${shortValue(session.workflowId)} from ${workflowSourceLabel(session.workflowSource)}.`,
    };
  }

  if (session.status === "requesting") {
    return {
      status: "Checking",
      tone: "active" as const,
      detail: `Requesting a ChatKit session through ${session.endpoint}.`,
    };
  }

  if (session.status === "error") {
    return {
      status: "Not reached",
      tone: "error" as const,
      detail: session.detail,
    };
  }

  return {
    status: "Waiting",
    tone: "warn" as const,
    detail: session.detail,
  };
}

function backendRoute(connection: BackendConnection) {
  if (connection.status === "ok") {
    return {
      status: "Reachable",
      tone: "ok" as const,
      detail: connection.agentName
        ? `Health check resolved agent ${connection.agentName}.`
        : connection.detail,
    };
  }
  if (connection.status === "error") {
    return {
      status: "Error",
      tone: "error" as const,
      detail: connection.detail,
    };
  }
  return {
    status: "Checking",
    tone: "neutral" as const,
    detail: "Waiting for the health check.",
  };
}

function responseRoute(response: ResponseSnapshot) {
  if (response.status === "responding") {
    return {
      status: "Running",
      tone: "active" as const,
      detail: response.detail,
    };
  }
  if (response.status === "complete") {
    return {
      status: "Complete",
      tone: "ok" as const,
      detail: response.detail,
    };
  }
  if (response.status === "error") {
    return {
      status: "Error",
      tone: "error" as const,
      detail: response.detail,
    };
  }
  return {
    status: "Idle",
    tone: "neutral" as const,
    detail: response.detail,
  };
}

function RoutingInspector({
  backend,
  session,
  response,
  events,
}: {
  backend: BackendConnection;
  session: SessionSnapshot;
  response: ResponseSnapshot;
  events: DiagnosticEvent[];
}) {
  const agent = sessionRoute(session, response);
  const backendStatus = backendRoute(backend);
  const responseStatus = responseRoute(response);

  return (
    <aside className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Routing inspector</p>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          Route signals only; private reasoning is not exposed.
        </p>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        <StatusRow
          title="Agent workflow"
          status={agent.status}
          detail={agent.detail}
          tone={agent.tone}
        />
        <StatusRow
          title="Generic ChatGPT"
          status="Inactive"
          detail="This app has no direct ChatGPT fallback; success means ChatKit is using the workflow session."
          tone="neutral"
        />
        <StatusRow
          title="Backend"
          status={backendStatus.status}
          detail={backendStatus.detail}
          tone={backendStatus.tone}
        />
        <StatusRow
          title="Active turn"
          status={responseStatus.status}
          detail={responseStatus.detail}
          tone={responseStatus.tone}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Recent events
        </h2>
        {events.length ? (
          <ol className="mt-3 space-y-3">
            {events.map((event) => (
              <li key={event.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 text-xs">
                <span className="font-mono text-slate-400 dark:text-slate-500">{event.time}</span>
                <span>
                  <span className={`inline-block rounded-full border px-2 py-0.5 font-semibold ${toneClasses(event.tone)}`}>
                    {event.label}
                  </span>
                  <span className="mt-1 block leading-5 text-slate-600 dark:text-slate-300">{event.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Waiting for ChatKit activity.
          </p>
        )}
      </div>
    </aside>
  );
}

// --- Main Panel ---

export function ChatKitPanel() {
  const [agentError, setAgentError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionSnapshot>(() => initialSessionSnapshot());
  const [response, setResponse] = useState<ResponseSnapshot>(() => initialResponseSnapshot());
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const backendDiagnostics = useBackendDiagnosticsConnection();
  const eventId = useRef(0);

  const appendEvent = useCallback((label: string, detail: string, tone: DiagnosticTone = "neutral") => {
    const event: DiagnosticEvent = {
      id: eventId.current,
      time: formatDiagnosticTime(),
      label,
      detail,
      tone,
    };
    eventId.current += 1;
    setEvents((current) => [event, ...current].slice(0, 10));
  }, []);

  const handleClientSecretEvent = useCallback((event: ClientSecretFetchEvent) => {
    const workflowDetail = event.workflowId
      ? `workflow ${shortValue(event.workflowId)} from ${workflowSourceLabel(event.workflowSource)}`
      : `workflow from ${workflowSourceLabel(event.workflowSource)}`;

    if (event.type === "session_reused") {
      setSession((current) => {
        const nextWorkflowId = event.workflowId ?? current.workflowId;
        const nextDetail = nextWorkflowId
          ? `Reusing existing client secret for workflow ${shortValue(nextWorkflowId)}.`
          : `Reusing existing client secret for ${workflowDetail}.`;
        return {
          status: "reused",
          endpoint: event.endpoint,
          workflowId: nextWorkflowId,
          workflowSource: event.workflowSource,
          detail: nextDetail,
          updatedAt: formatDiagnosticTime(),
        };
      });
      appendEvent("Session reused", workflowDetail, "ok");
      return;
    }

    if (event.type === "session_request_started") {
      setSession({
        status: "requesting",
        endpoint: event.endpoint,
        workflowId: event.workflowId,
        workflowSource: event.workflowSource,
        detail: `Requesting a ChatKit session for ${workflowDetail}.`,
        updatedAt: formatDiagnosticTime(),
      });
      appendEvent("Session request", workflowDetail, "active");
      return;
    }

    if (event.type === "session_request_succeeded") {
      setSession({
        status: "ready",
        endpoint: event.endpoint,
        workflowId: event.workflowId,
        workflowSource: event.workflowSource,
        expiresAfter: event.expiresAfter,
        detail: `ChatKit session created for ${workflowDetail}; expires_after ${formatExpiresAfter(event.expiresAfter)}.`,
        updatedAt: formatDiagnosticTime(),
      });
      appendEvent("Agent session", `Created for ${workflowDetail}.`, "ok");
      return;
    }

    setSession({
      status: "error",
      endpoint: event.endpoint,
      workflowId: event.workflowId,
      workflowSource: event.workflowSource,
      statusCode: event.status,
      detail: event.status ? `HTTP ${event.status}: ${event.error}` : event.error,
      updatedAt: formatDiagnosticTime(),
    });
    appendEvent("Session failed", event.status ? `HTTP ${event.status}: ${event.error}` : event.error, "error");
  }, [appendEvent]);

  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId, SESSION_ENDPOINT, handleClientSecretEvent),
    [handleClientSecretEvent]
  );

  const chatkit = useChatKit({
    api: ({
      getClientSecret,
    } satisfies HostedApiConfig),
    composer: {
      attachments: {
        enabled: true,
        accept: DOCUMENT_ACCEPT,
        maxCount: MAX_ATTACHMENTS,
        maxSize: MAX_DOCUMENT_BYTES,
      },
    },
    onError: (detail) => {
      const message = detail.error?.message ?? "Unbekannter Fehler vom Agenten";
      setAgentError(message);
      setResponse((current) => ({
        ...current,
        status: "error",
        detail: message,
        updatedAt: formatDiagnosticTime(),
      }));
      appendEvent("ChatKit error", message, "error");
    },
    onResponseStart: () => {
      setAgentError(null);
      setResponse((current) => ({
        ...current,
        status: "responding",
        detail: current.threadId
          ? `Agent response is streaming on thread ${shortValue(current.threadId)}.`
          : "Agent response is streaming.",
        updatedAt: formatDiagnosticTime(),
      }));
      appendEvent("Response start", "ChatKit emitted response.start.", "active");
    },
    onResponseEnd: () => {
      setResponse((current) => ({
        ...current,
        status: "complete",
        detail: current.threadId
          ? `Agent response completed on thread ${shortValue(current.threadId)}.`
          : "Agent response completed.",
        updatedAt: formatDiagnosticTime(),
      }));
      appendEvent("Response end", "ChatKit emitted response.end.", "ok");
    },
    onThreadChange: (detail) => {
      setResponse((current) => ({
        ...current,
        threadId: detail.threadId,
        detail: detail.threadId
          ? `Active thread ${shortValue(detail.threadId)}.`
          : "New thread view is active.",
        updatedAt: formatDiagnosticTime(),
      }));
      appendEvent(
        "Thread change",
        detail.threadId ? `Active thread ${shortValue(detail.threadId)}.` : "New thread view.",
        "neutral"
      );
    },
    onLog: (detail) => {
      appendEvent(
        "ChatKit log",
        detail.data ? `${detail.name}: ${JSON.stringify(detail.data)}` : detail.name,
        "neutral"
      );
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

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-[480px] min-w-0 overflow-hidden rounded-2xl shadow-sm">
          <ErrorBoundary>
            <ChatKit control={chatkit.control} className="h-full w-full" />
          </ErrorBoundary>
        </div>
        <RoutingInspector
          backend={backendDiagnostics}
          session={session}
          response={response}
          events={events}
        />
      </div>

    </div>
  );
}
