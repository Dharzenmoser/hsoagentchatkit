"""FastAPI entrypoint for exchanging workflow ids for ChatKit client secrets."""

from __future__ import annotations

import json
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any, Mapping

import httpx
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

DEFAULT_CHATKIT_BASE = "https://api.openai.com"
CHATKIT_WIDGET_SCRIPT_URL = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
SESSION_COOKIE_NAME = "chatkit_session_id"
SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days
CHATKIT_WIDGET_CACHE_SECONDS = 60 * 60
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
DEFAULT_UPLOAD_MIME_TYPE = "application/octet-stream"
ALLOWED_DOCUMENT_EXTENSIONS = {
    ".csv",
    ".doc",
    ".docx",
    ".htm",
    ".html",
    ".json",
    ".md",
    ".odp",
    ".ods",
    ".odt",
    ".pdf",
    ".ppt",
    ".pptx",
    ".rtf",
    ".tsv",
    ".txt",
    ".xls",
    ".xlsx",
    ".xml",
}
ALLOWED_DOCUMENT_MIME_TYPES = {
    "application/csv",
    "application/json",
    "application/msword",
    "application/pdf",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/xml",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/plain",
    "text/rtf",
    "text/tab-separated-values",
    "text/tsv",
    "text/xml",
}

app = FastAPI(title="Managed ChatKit Session API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> JSONResponse:
    agent_name = await _resolve_agent_name()
    return JSONResponse({"status": "ok", "agent_name": agent_name})


async def _resolve_agent_name() -> str | None:
    configured = os.getenv("CHATKIT_AGENT_NAME")
    if configured:
        return configured.strip()

    workflow_id = resolve_env_workflow_id()
    if not workflow_id:
        return None

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return workflow_id

    try:
        async with httpx.AsyncClient(base_url=chatkit_api_base(), timeout=3.0) as client:
            resp = await client.get(
                f"/v1/chatkit/workflows/{workflow_id}",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "OpenAI-Beta": "chatkit_beta=v1",
                },
            )
            if resp.is_success:
                data = parse_json(resp)
                name = data.get("name") or data.get("display_name")
                if isinstance(name, str) and name:
                    return name
    except Exception:
        pass

    return workflow_id


@app.get("/chatkit.js")
async def chatkit_widget_script() -> Response:
    """Serve the ChatKit widget same-origin to avoid browser/CDN HTTP/2 issues."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            upstream = await client.get(
                CHATKIT_WIDGET_SCRIPT_URL,
                headers={
                    "Accept": "application/javascript,*/*;q=0.8",
                    "Accept-Encoding": "identity",
                },
            )
    except httpx.RequestError as error:
        return javascript_error_response(
            f"Failed to load ChatKit widget script: {error}",
            502,
        )

    if not upstream.is_success:
        return javascript_error_response(
            f"Failed to load ChatKit widget script: HTTP {upstream.status_code}",
            502,
        )

    return Response(
        content=upstream.content,
        media_type="application/javascript",
        headers={
            "Cache-Control": f"public, max-age={CHATKIT_WIDGET_CACHE_SECONDS}, no-transform",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/api/create-session")
async def create_session(request: Request) -> JSONResponse:
    """Exchange a workflow id for a ChatKit client secret."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    body = await read_json_body(request)
    # Prefer server-side configuration, but ignore frontend build placeholders
    # that can exist in Docker/Vercel environments.
    env_workflow_id = resolve_env_workflow_id()
    body_workflow_id = resolve_workflow_id(body)
    workflow_id = env_workflow_id or body_workflow_id
    if not workflow_id:
        return respond({
            "error": "Missing workflow id — set CHATKIT_WORKFLOW_ID on the backend",
            "debug": {
                "env_CHATKIT_WORKFLOW_ID_set": bool(os.getenv("CHATKIT_WORKFLOW_ID")),
                "env_VITE_CHATKIT_WORKFLOW_ID_set": bool(os.getenv("VITE_CHATKIT_WORKFLOW_ID")),
                "body_workflow_id": body_workflow_id,
                "raw_body_keys": list(body.keys()),
            },
        }, 400)
    if not is_valid_workflow_id(workflow_id):
        return respond({
            "error": "Invalid workflow id — use a ChatKit workflow id that starts with wf_",
            "debug": {
                "workflow_id_source": "environment" if env_workflow_id else "request body",
            },
        }, 400)

    user_id, cookie_value = resolve_user(request.cookies)
    api_base = chatkit_api_base()

    session_payload: dict = {
        "workflow": {"id": workflow_id},
        "user": user_id,
        # Hosted ChatKit disables attachments unless the session opts in. Without
        # this the composer paperclip uploads fail with HTTP 400
        # ("File uploads are disabled for this session"). max_file_size is in MB.
        "chatkit_configuration": {
            "file_upload": {
                "enabled": True,
                "max_files": 5,
                "max_file_size": 50,
            }
        },
    }

    print(f"[create-session] calling OpenAI — workflow={workflow_id}")

    try:
        async with httpx.AsyncClient(base_url=api_base, timeout=10.0) as client:
            upstream = await client.post(
                "/v1/chatkit/sessions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "OpenAI-Beta": "chatkit_beta=v1",
                    "Content-Type": "application/json",
                },
                json=session_payload,
            )
    except httpx.RequestError as error:
        return respond(
            {"error": f"Failed to reach ChatKit API: {error}"},
            502,
            cookie_value,
        )

    payload = parse_json(upstream)
    print(f"[create-session] OpenAI responded — status={upstream.status_code} body={dict(payload)}")

    if not upstream.is_success:
        message = None
        if isinstance(payload, Mapping):
            message = payload.get("error") or payload.get("message")
            # Nested OpenAI error objects: {"error": {"message": "...", "type": "..."}}
            raw_error = payload.get("error")
            if isinstance(raw_error, Mapping):
                message = raw_error.get("message") or str(raw_error)
        message = message or upstream.reason_phrase or "Failed to create session"
        print(f"[create-session] error forwarded to client — {upstream.status_code}: {message}")
        return respond({"error": message}, upstream.status_code, cookie_value)

    client_secret = None
    expires_after = None
    if isinstance(payload, Mapping):
        client_secret = payload.get("client_secret")
        expires_after = payload.get("expires_after")

    if not client_secret:
        return respond(
            {"error": "Missing client secret in response"},
            502,
            cookie_value,
        )

    return respond(
        {
            "client_secret": client_secret,
            "expires_after": expires_after,
            "workflow_id": workflow_id,
        },
        200,
        cookie_value,
    )


@app.post("/api/upload-file")
async def upload_file(file: UploadFile = File(...)) -> JSONResponse:
    """Upload a user document to OpenAI Files for ChatKit attachments."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    filename = safe_upload_filename(file.filename)
    mime_type = resolve_upload_mime_type(file.content_type, filename)
    if not is_allowed_document_upload(filename, mime_type):
        print(
            "[upload-file] rejected unsupported upload "
            f"filename={filename} mime_type={mime_type}"
        )
        return respond(
            {
                "error": "Unsupported document type. Upload PDF, Word, Excel, PowerPoint, OpenDocument, text, HTML, Markdown, CSV, TSV, XML, or JSON files.",
            },
            400,
        )

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        print(f"[upload-file] rejected empty upload filename={filename}")
        return respond({"error": "Uploaded document is empty"}, 400)
    if len(content) > MAX_UPLOAD_BYTES:
        print(
            "[upload-file] rejected oversized upload "
            f"filename={filename} size={len(content)} limit={MAX_UPLOAD_BYTES}"
        )
        return respond({"error": "Uploaded document is larger than 50 MB"}, 400)

    api_base = chatkit_api_base()
    try:
        async with httpx.AsyncClient(base_url=api_base, timeout=30.0) as client:
            upstream = await client.post(
                "/v1/files",
                headers={"Authorization": f"Bearer {api_key}"},
                data={"purpose": "user_data"},
                files={"file": (filename, content, mime_type)},
            )
    except httpx.RequestError as error:
        return respond({"error": f"Failed to upload document: {error}"}, 502)

    payload = parse_json(upstream)
    if not upstream.is_success:
        message = upstream_error_message(payload, upstream.reason_phrase)
        print(
            "[upload-file] OpenAI upload failed "
            f"status={upstream.status_code} filename={filename} error={message}"
        )
        return respond(
            {"error": message},
            upstream.status_code,
        )

    file_id = payload.get("id") if isinstance(payload, Mapping) else None
    if not isinstance(file_id, str) or not file_id:
        return respond({"error": "Missing file id in upload response"}, 502)

    return respond(
        {
            "type": "file",
            "id": file_id,
            "name": filename,
            "mime_type": mime_type,
        },
        200,
    )


def respond(
    payload: Mapping[str, Any], status_code: int, cookie_value: str | None = None
) -> JSONResponse:
    response = JSONResponse(payload, status_code=status_code)
    if cookie_value:
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=cookie_value,
            max_age=SESSION_COOKIE_MAX_AGE_SECONDS,
            httponly=True,
            samesite="lax",
            secure=is_prod(),
            path="/",
        )
    return response


def javascript_error_response(message: str, status_code: int) -> Response:
    escaped = json.dumps(message)
    return Response(
        content=f"console.error({escaped});",
        status_code=status_code,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


def is_prod() -> bool:
    env = (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "").lower()
    return env == "production"


async def read_json_body(request: Request) -> Mapping[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, Mapping) else {}


def resolve_workflow_id(body: Mapping[str, Any]) -> str | None:
    workflow = body.get("workflow", {})
    workflow_id = None
    if isinstance(workflow, Mapping):
        workflow_id = workflow.get("id")
    workflow_id = workflow_id or body.get("workflowId") or body.get("workflow_id")
    return normalize_workflow_id(workflow_id)


def resolve_env_workflow_id() -> str | None:
    for key in ("CHATKIT_WORKFLOW_ID", "VITE_CHATKIT_WORKFLOW_ID"):
        workflow_id = normalize_workflow_id(os.getenv(key))
        if workflow_id:
            return workflow_id
    return None


def normalize_workflow_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    workflow_id = value.strip()
    if not workflow_id or is_placeholder_workflow_id(workflow_id):
        return None
    return workflow_id


def is_placeholder_workflow_id(workflow_id: str) -> bool:
    normalized = workflow_id.lower()
    return normalized in {"replace_me_workflow_id", "replace_me"} or normalized.startswith(
        "wf_replace"
    )


def is_valid_workflow_id(workflow_id: str) -> bool:
    return workflow_id.startswith("wf_")


def safe_upload_filename(filename: str | None) -> str:
    if not filename:
        return "document"
    normalized = filename.replace("\\", "/").split("/")[-1].strip()
    return normalized.replace("\x00", "") or "document"


def resolve_upload_mime_type(content_type: str | None, filename: str) -> str:
    guessed_type = mimetypes.guess_type(filename)[0]
    if content_type:
        normalized = content_type.split(";", 1)[0].strip().lower()
        if normalized and normalized != DEFAULT_UPLOAD_MIME_TYPE:
            return normalized
    return guessed_type or DEFAULT_UPLOAD_MIME_TYPE


def is_allowed_document_upload(filename: str, mime_type: str) -> bool:
    extension = os.path.splitext(filename.lower())[1]
    return (
        mime_type in ALLOWED_DOCUMENT_MIME_TYPES
        or extension in ALLOWED_DOCUMENT_EXTENSIONS
    )


def upstream_error_message(payload: Mapping[str, Any], fallback: str | None) -> str:
    raw_error = payload.get("error") if isinstance(payload, Mapping) else None
    if isinstance(raw_error, Mapping):
        message = raw_error.get("message")
        if isinstance(message, str) and message:
            return message
    if isinstance(raw_error, str) and raw_error:
        return raw_error
    message = payload.get("message") if isinstance(payload, Mapping) else None
    if isinstance(message, str) and message:
        return message
    return fallback or "OpenAI upload failed"


def resolve_user(cookies: Mapping[str, str]) -> tuple[str, str | None]:
    existing = cookies.get(SESSION_COOKIE_NAME)
    if existing:
        return existing, None
    user_id = str(uuid.uuid4())
    return user_id, user_id


def chatkit_api_base() -> str:
    return (
        os.getenv("CHATKIT_API_BASE")
        or os.getenv("VITE_CHATKIT_API_BASE")
        or DEFAULT_CHATKIT_BASE
    )


def parse_json(response: httpx.Response) -> Mapping[str, Any]:
    try:
        parsed = response.json()
        return parsed if isinstance(parsed, Mapping) else {}
    except (json.JSONDecodeError, httpx.DecodingError):
        return {}


def resolve_frontend_dist() -> Path | None:
    candidates: list[Path] = []
    configured_path = os.getenv("FRONTEND_DIST_DIR")
    if configured_path:
        candidates.append(Path(configured_path))
    candidates.extend(
        (
            Path("/app/frontend/dist"),
            Path(__file__).resolve().parents[2] / "frontend" / "dist",
        )
    )

    for candidate in candidates:
        frontend_path = candidate.expanduser().resolve()
        if (frontend_path / "index.html").is_file():
            return frontend_path
    return None


frontend_path = resolve_frontend_dist()

if frontend_path:
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
else:
    print("WARNING: Frontend dist directory not found; running API-only.")
