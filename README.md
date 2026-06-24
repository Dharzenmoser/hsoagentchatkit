# Managed ChatKit starter

Vite + React UI that talks to a FastAPI session backend for creating ChatKit
workflow sessions.

## Quick start

Prerequisites:

- Node.js 20.19 or newer
- npm 9 or newer

```bash
npm install           # installs root deps (concurrently)
npm run dev           # runs FastAPI on :8000 and Vite on :3000
```

What happens:

- `npm run dev` runs the backend via `backend/scripts/run.sh` (FastAPI +
  uvicorn) and the frontend via `npm --prefix frontend run dev`.
- The backend exposes `/api/create-session`, exchanging your workflow id and
  `OPENAI_API_KEY` for a ChatKit client secret. The Vite dev server proxies
  `/api/*` to `127.0.0.1:8000`.

## Required environment

- `OPENAI_API_KEY`
- `CHATKIT_WORKFLOW_ID` (recommended for deployments)
- `VITE_CHATKIT_WORKFLOW_ID` (optional local fallback when the backend is not configured)
- (optional) `CHATKIT_API_BASE` or `VITE_CHATKIT_API_BASE` (defaults to `https://api.openai.com`)
- (optional) `VITE_API_BASE` (browser-facing backend base URL; leave empty for same-origin `/api`)
- (optional) `VITE_API_URL` (legacy alias for `VITE_API_BASE`; also used by Vite to override the dev proxy target)

Set the env vars in your shell (or process manager) before running. Use a
workflow id from Agent Builder (starts with `wf_...`) and an API key from the
same project and organization.

The ChatKit browser script is loaded directly from OpenAI's CDN
(`https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`). It must NOT
be proxied same-origin: ChatKit derives its iframe URL from the directory of its
own `<script>` src, so serving it from this app's origin makes the widget iframe
resolve to `<origin>/index-*.html`, which the SPA fallback answers with the
app's own `index.html` — causing the app to embed itself recursively. (The
backend still exposes a `/chatkit.js` proxy route, but it is unused by the
frontend.)

Do not send `API_DOMAIN_KEY` to the hosted ChatKit session endpoint. Domain
allow-listing is configured in Agent Builder; the session request only needs
your API key, workflow id, and app user id.

## Document uploads

The composer includes a paperclip upload button. With the OpenAI-hosted
integration, attachments are uploaded by ChatKit directly to OpenAI and made
available to the workflow — uploads only work when the session is created with
`chatkit_configuration.file_upload.enabled = true` (see `create-session` in
`backend/app/main.py`). The session also sets `max_files` and `max_file_size`
(MB). The client-side `uploadStrategy` (`direct`/`two_phase`) only applies to a
self-hosted ChatKit backend, so it is intentionally not set here.

Note: ChatKit's hosted backend enforces its own MIME allow-list for the native
paperclip. PDFs and images upload there. Word, Excel, CSV, PDF, and ZIP files
can also use the separate `Dokumente als PDF hochladen` button. That endpoint
accepts up to 20 selected documents, extracts supported files from ZIP archives,
converts them into one combined PDF through LibreOffice, uploads that PDF to
OpenAI Files, and attaches the returned PDF file id to the ChatKit composer.
The conversion backend needs LibreOffice available on the server; the Docker
runtime image installs it.

## Customize

- UI: `frontend/src/components/ChatKitPanel.tsx`
- Session logic: `backend/app/main.py`
