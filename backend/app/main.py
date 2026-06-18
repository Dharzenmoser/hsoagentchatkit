"""FastAPI entrypoint for exchanging workflow ids for ChatKit client secrets."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, Mapping

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from fastapi.staticfiles import StaticFiles
import os

DEFAULT_CHATKIT_BASE = "https://api.openai.com"
SESSION_COOKIE_NAME = "chatkit_session_id"
SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days

app = FastAPI(title="Managed ChatKit Session API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> Mapping[str, str]:
    return {"status": "ok"}


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

    session_payload: dict = {"workflow": {"id": workflow_id}, "user": user_id}

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
        {"client_secret": client_secret, "expires_after": expires_after},
        200,
        cookie_value,
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

# --- FIX FÜR DOCKER DEPLOYMENT ---
# Prüfen, ob der Frontend-Ordner im Container existiert
# (Wir haben ihn im Dockerfile nach /app/frontend/dist kopiert)
frontend_path = "/app/frontend/dist"

if os.path.exists(frontend_path):
    # API-Routen haben Vorrang, der Rest geht ans Frontend
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    print(f"WARNUNG: Frontend Pfad {frontend_path} nicht gefunden!")
