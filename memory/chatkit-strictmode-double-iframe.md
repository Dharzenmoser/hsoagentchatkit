---
name: chatkit-strictmode-double-iframe
description: Why ChatKit opened multiple iframes/frames and the fix
metadata:
  type: project
---

ChatKit was rendering "mehrere Frames" (multiple `<openai-chatkit>` iframes). Cause:
the app (React 19) wrapped `<App />` in `<StrictMode>` in
`frontend/src/main.tsx`. The `@openai/chatkit-react` `ChatKit` component
initializes the web component in a `useLayoutEffect` whose cleanup does NOT tear
the widget down — so StrictMode's dev-only setup→cleanup→setup cycle mounts the
widget twice. Only happens in dev (`npm run dev`); production builds don't
double-invoke. `useChatKit` options are structurally stable (constants +
functions ignored by `deepEqualIgnoringFns`), so re-renders alone don't dupe.

Fix: render `createRoot(...).render(<App />)` WITHOUT StrictMode. Tradeoff: lose
StrictMode's dev checks for the whole app; acceptable since there's no clean way
to exclude only the ChatKit subtree. See [[chatkit-hosted-file-upload]].
