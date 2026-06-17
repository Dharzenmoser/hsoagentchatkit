import { ChatKitPanel } from "./components/ChatKitPanel";

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-end bg-slate-100 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-5xl pb-4">
        <div className="mb-3 px-1">
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
