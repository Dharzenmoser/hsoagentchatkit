import { ChatKitPanel } from "./components/ChatKitPanel";

export default function App() {
  return (
    <main className="flex h-screen flex-col items-center bg-slate-100 dark:bg-slate-950 px-4 py-4">
      <div className="flex w-full max-w-5xl flex-col h-full gap-3">
        <div className="px-1 shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Harzis DocEval</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Dokumente mit KI evaluieren — nutze den Chat, um mit dem System zu interagieren.
          </p>
        </div>
        <ChatKitPanel />
      </div>
    </main>
  );
}
