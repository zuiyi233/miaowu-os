from __future__ import annotations

import base64
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.routers import images as images_router
from app.gateway.routers.images_support import service as images_service

_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
)
_UNSET = object()


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, settings: object | None):
        self._settings = settings

    async def execute(self, _stmt):
        return _ScalarResult(self._settings)


@pytest.fixture(autouse=True)
def _reset_images_runtime(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MIAOWU_IMAGE_ASSET_DIR", str(tmp_path / "images"))
    for key in (
        "MIAOWU_NEWAPI_BASE_URL",
        "NEWAPI_OPENAI_BASE_URL",
        "NEWAPI_PROVIDER_BASE_URL",
        "NEWAPI_AI_BASE_URL",
        "OPENAI_BASE_URL",
        "OPENAI_API_BASE",
        "MIAOWU_NEWAPI_API_KEY",
        "NEWAPI_PROVIDER_API_KEY",
        "NEWAPI_AI_API_KEY",
        "NEWAPI_API_KEY",
        "OPENAI_API_KEY",
        "OPENAI_IMAGE_MODEL",
        "MIAOWU_IMAGE_MODEL",
        "OPENAI_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)
    images_service._http_client = None


def _build_app(*, override_user: bool = True, db: object = None) -> FastAPI:
    app = FastAPI()
    app.include_router(images_router.router)
    if override_user:
        app.dependency_overrides[get_user_id] = lambda: "test-user"
    if db is not _UNSET:
        app.dependency_overrides[images_router.get_optional_db] = lambda: db
    return app


def test_generate_images_success_uses_user_ai_runtime_config(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_db = _FakeDB(SimpleNamespace(user_id="test-user"))
    seen: dict[str, object] = {}

    def fake_resolve(settings, *, ai_provider_id=None, ai_model=None, module_id=None):
        seen["settings"] = settings
        seen["ai_provider_id"] = ai_provider_id
        seen["ai_model"] = ai_model
        seen["module_id"] = module_id
        return (
            {
                "api_provider": "openai",
                "api_key": "db-secret",
                "api_base_url": "https://provider.example/v1",
                "model_name": ai_model or "db-image-model",
                "temperature": 0.0,
                "max_tokens": 0,
            },
            "feature-routing:images",
        )

    async def mock_post(self, url, **kwargs):
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        seen["headers"] = kwargs.get("headers")
        return httpx.Response(
            200,
            json={
                "created": 123,
                "data": [
                    {
                        "b64_json": base64.b64encode(_PNG_BYTES).decode("ascii"),
                        "revised_prompt": "revised prompt",
                    }
                ],
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(images_service, "resolve_user_ai_runtime_config", fake_resolve)
    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    app = _build_app(db=fake_db)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "prompt": "draw a cat",
                "model": "request-model",
                "size": "1024x1024",
                "quality": "high",
                "n": 1,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["model"] == "request-model"
    assert payload["response_metadata"]["config_source"] == "feature-routing:images"
    assert payload["images"][0]["content_type"] == "image/png"
    assert payload["images"][0]["filename"].endswith(".png")
    assert payload["images"][0]["revised_prompt"] == "revised prompt"
    assert payload["image_urls"] == [payload["images"][0]["url"]]
    assert seen["module_id"] == "images"
    assert seen["ai_model"] == "request-model"
    assert seen["url"] == "https://provider.example/v1/images/generations"
    assert seen["json"] == {
        "prompt": "draw a cat",
        "model": "request-model",
        "n": 1,
        "response_format": "b64_json",
        "size": "1024x1024",
        "quality": "high",
    }
    assert seen["headers"]["Authorization"] == "Bearer db-secret"


def test_generate_images_uses_env_fallback_and_supports_url_history_detail_and_file_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setenv("OPENAI_BASE_URL", "https://env-provider.example/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "env-secret")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "env-image-model")

    async def mock_post(self, url, **kwargs):
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        return httpx.Response(
            200,
            json={
                "created": 456,
                "data": [
                    {
                        "url": "https://cdn.example/generated.png",
                    }
                ],
            },
            request=httpx.Request("POST", url),
        )

    async def mock_download(_client, url):
        seen["download_url"] = url
        return _PNG_BYTES, "image/png"

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    monkeypatch.setattr(images_service, "_download_image_from_url", mock_download)

    app = _build_app(db=None)
    with TestClient(app) as client:
        generate_response = client.post(
            "/api/v1/images/generate",
            json={"prompt": "draw a moonlit city"},
        )
        assert generate_response.status_code == 200
        generated = generate_response.json()

        list_response = client.get("/api/v1/images/jobs")
        detail_response = client.get(f"/api/v1/images/jobs/{generated['id']}")
        file_response = client.get(f"/api/v1/images/files/{generated['images'][0]['image_id']}")

    assert generated["response_metadata"]["config_source"] == "env-fallback"
    assert generated["model"] == "env-image-model"
    assert seen["url"] == "https://env-provider.example/v1/images/generations"
    assert seen["json"]["model"] == "env-image-model"
    assert seen["download_url"] == "https://cdn.example/generated.png"

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["id"] == generated["id"]

    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["id"] == generated["id"]
    assert detail_payload["images"][0]["source_url"] == "https://cdn.example/generated.png"

    assert file_response.status_code == 200
    assert file_response.content == _PNG_BYTES
    assert file_response.headers["content-type"] == "image/png"
    assert "inline; filename=" in file_response.headers["content-disposition"]


def test_image_history_reads_legacy_sha1_user_directories() -> None:
    legacy_key = hashlib.sha1(b"test-user").hexdigest()[:24]
    job_id = "legacy-job"
    image_id = "legacy-image"
    created_at = "2026-05-26T00:00:00+00:00"

    job_dir = images_service._jobs_root() / legacy_key
    file_dir = images_service._files_root() / legacy_key
    job_dir.mkdir(parents=True, exist_ok=True)
    file_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / f"{job_id}.json").write_text(
        json.dumps(
            {
                "id": job_id,
                "user_id": "test-user",
                "status": "completed",
                "operation": "generate",
                "source": "workspace-images",
                "prompt": "legacy prompt",
                "model": "legacy-model",
                "request_params": {},
                "response_metadata": {},
                "images": [
                    {
                        "image_id": image_id,
                        "url": f"/api/v1/images/files/{image_id}",
                        "filename": "legacy.png",
                        "content_type": "image/png",
                        "size_bytes": len(_PNG_BYTES),
                    }
                ],
                "image_urls": [f"/api/v1/images/files/{image_id}"],
                "error": None,
                "elapsed_seconds": 0.1,
                "created_at": created_at,
                "updated_at": created_at,
            }
        ),
        encoding="utf-8",
    )
    (file_dir / f"{image_id}.json").write_text(
        json.dumps(
            {
                "image_id": image_id,
                "job_id": job_id,
                "user_id": "test-user",
                "filename": "legacy.png",
                "content_type": "image/png",
                "extension": "png",
                "size_bytes": len(_PNG_BYTES),
                "created_at": created_at,
            }
        ),
        encoding="utf-8",
    )
    (file_dir / f"{image_id}.png").write_bytes(_PNG_BYTES)

    app = _build_app(db=None)
    with TestClient(app) as client:
        list_response = client.get("/api/v1/images/jobs")
        detail_response = client.get(f"/api/v1/images/jobs/{job_id}")
        file_response = client.get(f"/api/v1/images/files/{image_id}")

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["id"] == job_id
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == job_id
    assert file_response.status_code == 200
    assert file_response.content == _PNG_BYTES


def test_generate_images_returns_503_when_config_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def should_not_call(*args, **kwargs):
        raise AssertionError("upstream image endpoint should not be called when config is missing")

    monkeypatch.setattr(httpx.AsyncClient, "post", should_not_call)

    app = _build_app(db=None)
    with TestClient(app) as client:
        generate_response = client.post(
            "/api/v1/images/generate",
            json={"prompt": "draw an unconfigured image"},
        )
        jobs_response = client.get("/api/v1/images/jobs")

    assert generate_response.status_code == 503
    payload = generate_response.json()
    assert payload["detail"]["error_code"] == "missing_config"
    assert payload["detail"]["source"] == "env-fallback"

    assert jobs_response.status_code == 200
    jobs = jobs_response.json()["items"]
    assert len(jobs) == 1
    assert jobs[0]["status"] == "failed"
    assert jobs[0]["error"]["error_code"] == "missing_config"


@pytest.mark.parametrize(
    ("payload", "field_name"),
    [
        ({"prompt": "   "}, "prompt"),
        ({"prompt": "draw", "n": 0}, "n"),
        ({"prompt": "draw", "size": "512x512"}, "size"),
        ({"prompt": "draw", "aspect_ratio": "7:5"}, "aspect_ratio"),
        ({"prompt": "draw", "size": "1024x1024", "aspect_ratio": "1:1"}, "size and aspect_ratio"),
    ],
)
def test_generate_images_validates_request_payload(
    payload: dict[str, object],
    field_name: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def should_not_call(*args, **kwargs):
        raise AssertionError("validation failure should stop before upstream call")

    monkeypatch.setattr(httpx.AsyncClient, "post", should_not_call)

    app = _build_app(db=None)
    with TestClient(app) as client:
        response = client.post("/api/v1/images/generate", json=payload)

    assert response.status_code == 422
    assert any(
        field_name in str(item.get("loc")) or field_name in str(item.get("msg"))
        for item in response.json()["detail"]
    )


def test_generate_images_requires_authenticated_user() -> None:
    app = _build_app(override_user=False, db=None)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/images/generate",
            json={"prompt": "draw a locked workspace"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/images/jobs"),
        ("GET", "/api/v1/images/jobs/job-1"),
        ("GET", "/api/v1/images/files/image-1"),
    ],
)
def test_image_read_routes_require_authenticated_user(
    method: str,
    path: str,
) -> None:
    app = _build_app(override_user=False, db=None)
    with TestClient(app) as client:
        response = client.request(method, path)

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"
