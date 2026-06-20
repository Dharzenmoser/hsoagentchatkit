---
name: chatkit-multiple-frames
description: Real cause of ChatKit "mehrere Frames" — same-origin chatkit.js proxy caused recursive app embedding
metadata:
  type: project
---

The "mehrere Frames" symptom was the WHOLE app rendering nested inside itself
recursively (header + connection banner + ChatKit panel, ~3 levels deep), NOT
duplicate ChatKit iframes.

Root cause: the frontend loaded the ChatKit script from a same-origin proxy
(`/chatkit.js`, proxied by the backend from the CDN). ChatKit's loader builds its
iframe URL from the directory of its own `<script>` src
(`document.currentScript.src` → strip filename → append `index-*.html`). Served
same-origin, the iframe resolved to `<app-origin>/index-*.html`, which the SPA
fallback answered with the app's own `index.html` → the app embedded itself →
recursion.

Fix: load chatkit.js directly from the CDN
(`https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`) in
`frontend/src/lib/loadChatKitScript.ts`. Do NOT proxy it same-origin. Removed the
now-dead `/chatkit.js` dev proxy in `vite.config.ts`; the backend `/chatkit.js`
route remains but is unused.

Secondary/defensive: StrictMode was also removed from `frontend/src/main.tsx`
(React 19) because the chatkit-react component inits the widget in a
useLayoutEffect whose cleanup doesn't tear it down, so StrictMode's dev
setup→cleanup→setup can double-mount the widget. That was a real but separate
concern, not the cause of the recursion seen here. See
[[chatkit-hosted-file-upload]].
