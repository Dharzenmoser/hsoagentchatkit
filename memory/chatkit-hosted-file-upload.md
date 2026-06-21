---
name: chatkit-hosted-file-upload
description: How file uploads work in this hosted ChatKit app and what was failing
metadata:
  type: project
---

Hosted ChatKit (using `getClientSecret`) uploads attachments directly to OpenAI's
hosted backend — it does NOT use the client-side `uploadStrategy`
(`direct`/`two_phase`), which only applies to a self-hosted `CustomApiConfig`
(SDK types reflect this: `uploadStrategy` lives on `CustomApiConfig`, not
`HostedApiConfig`).

The "Failed to upload file: Request failed with status 400" error was caused by
creating the session WITHOUT enabling uploads. Hosted ChatKit disables
attachments by default; the session POST to `/v1/chatkit/sessions` must include
`chatkit_configuration.file_upload.enabled = true` (plus `max_files`,
`max_file_size` in MB). Fixed in `backend/app/main.py` create-session, and the
inert `uploadStrategy` was removed from `frontend/src/components/ChatKitPanel.tsx`.

The earlier `/api/upload-file` backend endpoint (proxy to OpenAI `/v1/files` with
`purpose=user_data`) is now orphaned — hosted ChatKit never calls it. Verified
OpenAI accepts the new session payload (200 + client_secret).

Note: ChatKit's hosted backend enforces its own MIME allow-list; CSV/XLSX may be
rejected server-side (`chatkit.file_upload_type_rejected`) even with uploads
enabled. Diagnostic creds were in env as `MY_OPENAI_KEY` / `MY_WORKFLOW_ID`.

2026-06-21 round: upload still failed immediately with generic toast
("Hochladen der Datei fehlgeschlagen"). Real network error was
`Invalid method for URL (GET /v1/chatkit/files)` — the widget sent GET to a
POST-only endpoint. So it is NOT a backend/session/Agent problem (session config
is correct); it's the ChatKit CLIENT layer emitting the wrong verb. Prime suspect:
version skew — `chatkit.js` is loaded always-latest/unversioned from the CDN
(loadChatKitScript.ts) while npm is pinned at the floor (`@openai/chatkit-react`
1.1.1 / `@openai/chatkit` 1.0.0). Fix path: `npm install @openai/chatkit-react@latest`
in frontend/, rebuild, hard-reload/incognito to bust the CDN cache, then confirm
the `/v1/chatkit/files` request is POST 200. If it still GETs after alignment,
it's an OpenAI-side bug (see chatkit-js issue #13). Do NOT change the Agent for
this.
