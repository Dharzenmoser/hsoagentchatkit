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

2026-06-22 update: the npm bump was applied and committed (a4270b1). Installed
now: `@openai/chatkit-react` 1.5.1 and `@openai/chatkit` 1.7.0.

2026-06-22 ROOT CAUSE FOUND (supersedes the version-skew theory above). Reproduced
end-to-end with curl using MY_OPENAI_KEY / MY_WORKFLOW_ID
(wf_6a27865d77c08190915df46d9d101a1501a481ef841d1e4d):
- POST /v1/chatkit/sessions → 200, and the returned config shows
  file_upload.enabled=true. So session/backend is CORRECT.
- POST /v1/chatkit/files with client_secret (ek_) as bearer + OpenAI-Beta header
  is the real upload path (multipart `file`). Returns the cfile_ object.
- The hosted backend enforces a per-workflow file-type ALLOW-LIST. For this
  workflow it accepts ONLY images (png/jpeg/gif/webp) and application/pdf → 200.
  EVERY office/text type (txt, csv, tsv, json, md, html, xml, rtf, doc, docx, xls,
  xlsx, ppt, pptx) → HTTP 400 `chatkit.file_upload_type_rejected`
  ("Uploaded file type is not allowed for this session"). (Endpoint is also rate
  limited at 10 req/min → spurious 429s when probing fast.)
- Bug in our app: frontend `composer.attachments.accept` (DOCUMENT_ACCEPT in
  ChatKitPanel.tsx) listed ONLY document types, all of which 400 → every pickable
  file failed. FIXED: DOCUMENT_ACCEPT now lists only pdf + images.
- To actually accept documents, the WORKFLOW's file-input config must be widened in
  OpenAI Agent Builder — NOT changeable from this repo. The orphaned backend
  /api/upload-file + its ALLOWED_DOCUMENT_* lists are unused by hosted ChatKit.
