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
