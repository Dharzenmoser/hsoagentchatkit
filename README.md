# Managed ChatKit starter

Vite + React UI that talks to a FastAPI session backend for creating ChatKit
workflow sessions.

## Quick start

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
- `VITE_CHATKIT_WORKFLOW_ID`
- (optional) `CHATKIT_API_BASE` or `VITE_CHATKIT_API_BASE` (defaults to `https://api.openai.com`)
- (optional) `VITE_API_BASE` (browser-facing backend base URL; leave empty for same-origin `/api`)
- (optional) `VITE_API_URL` (legacy alias for `VITE_API_BASE`; also used by Vite to override the dev proxy target)

Set the env vars in your shell (or process manager) before running. Use a
workflow id from Agent Builder (starts with `wf_...`) and an API key from the
same project and organization.

Do not send `API_DOMAIN_KEY` to the hosted ChatKit session endpoint. Domain
allow-listing is configured in Agent Builder; the session request only needs
your API key, workflow id, and app user id.

## Document uploads

The custom composer includes a paperclip upload button. Uploaded documents are
proxied through `/api/upload-file`, stored with OpenAI Files using
`purpose=user_data`, and then sent to ChatKit as message attachments. Supported
formats are PDF, Word, Excel, PowerPoint, text, Markdown, CSV, and JSON up to
25 MB per file.

## Customize

- UI: `frontend/src/components/ChatKitPanel.tsx`
- Session logic: `backend/app/main.py`
