from __future__ import annotations

import base64
import json
import wave
from dataclasses import dataclass
from io import BytesIO

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.object_storage_service import ObjectStorageError
from app.gateway.routers import tts as tts_router
from app.gateway.routers.tts_support import service as tts_service


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(tts_router.router)
    app.dependency_overrides[get_user_id] = lambda: "test-user"
    app.dependency_overrides[tts_router.get_optional_db] = lambda: None
    return app


def _reset_tts_runtime_state() -> None:
    tts_service._chapter_jobs.clear()
    tts_service._chapter_manifests.clear()
    tts_service._audio_cache.clear()
    tts_service._local_audio_assets.clear()
    tts_service._narration_plans.clear()


def _wav_bytes(duration_ms: int = 40, *, sample_rate: int = 8000) -> bytes:
    frames = max(1, int(sample_rate * duration_ms / 1000))
    out = BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"\x00\x00" * frames)
    return out.getvalue()


def test_get_tts_config_respects_explicit_tts_env_availability(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_TTS_BASE_URL", "http://127.0.0.1:8551/v1")
    monkeypatch.setenv("VOLCENGINE_TTS_APPID", "app-id")
    monkeypatch.setenv("VOLCENGINE_TTS_ACCESS_TOKEN", "token")
    monkeypatch.delenv("MOSS_TTS_BASE_URL", raising=False)

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openai"]["available"] is True
    assert payload["providers"]["volcengine"]["available"] is True
    assert payload["providers"]["moss-local"]["available"] is True
    assert payload["providers"]["moss-local"]["base_url"] == "http://localhost:18083"
    assert payload["providers"]["openai"]["default_model"] == "gpt-4o-mini-tts"
    assert payload["providers"]["openai"]["default_format"] == "mp3"
    assert payload["providers"]["moss-local"]["default_model"] == "moss-tts-nano"
    assert payload["providers"]["moss-local"]["default_format"] == "wav"
    assert payload["providers"]["openai"]["supports_streaming"] is True
    assert payload["capabilities"]["moss-local"]["health_endpoints"] == [
        "/health",
        "/api/warmup-status",
        "/api/text-normalization-status",
    ]
    assert payload["default_provider"] == "openai"


def test_get_tts_config_ignores_regular_openai_env_for_tts_availability(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:8551/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "chat-key")
    monkeypatch.delenv("OPENAI_TTS_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_TTS_API_BASE", raising=False)
    monkeypatch.delenv("TTS_OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("TTS_OPENAI_API_BASE", raising=False)
    monkeypatch.delenv("VOLCENGINE_TTS_APPID", raising=False)
    monkeypatch.delenv("VOLCENGINE_TTS_ACCESS_TOKEN", raising=False)

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openai"]["available"] is False
    assert payload["providers"]["openai"]["config_source"] is None
    assert payload["providers"]["moss-local"]["available"] is True
    assert payload["default_provider"] == "moss-local"


def test_get_tts_config_uses_volcengine_when_openai_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)
    monkeypatch.setenv("VOLCENGINE_TTS_APPID", "app-id")
    monkeypatch.setenv("VOLCENGINE_TTS_ACCESS_TOKEN", "token")

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openai"]["available"] is False
    assert payload["providers"]["volcengine"]["available"] is True
    assert payload["default_provider"] == "volcengine"
    assert payload["defaults"]["moss_voice"] == "demo-1"


@dataclass
class _SettingsStub:
    api_provider: str = "openai"
    api_key: str | None = None
    api_base_url: str = "http://127.0.0.1:3000/v1"
    llm_model: str = "claude-haiku-4-5"
    temperature: float = 0.7
    max_tokens: int = 2000
    preferences: str | None = None


class _AISettingsServiceStub:
    def __init__(self, settings: _SettingsStub) -> None:
        self._settings = settings

    async def get_or_create_settings(self, user_id, db):  # noqa: ANN001
        return self._settings


@pytest.mark.asyncio
async def test_get_tts_config_does_not_treat_default_ai_provider_as_openai_tts(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)
    monkeypatch.delenv("OPENAI_TTS_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_TTS_API_BASE", raising=False)
    monkeypatch.delenv("TTS_OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("TTS_OPENAI_API_BASE", raising=False)
    monkeypatch.delenv("VOLCENGINE_TTS_APPID", raising=False)
    monkeypatch.delenv("VOLCENGINE_TTS_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(
        tts_service,
        "get_ai_settings_service",
        lambda: _AISettingsServiceStub(_SettingsStub()),
    )

    payload = await tts_service.build_config_response(user_id="test-user", db=object())

    assert payload.providers["openai"]["available"] is False
    assert payload.providers["openai"]["config_source"] is None
    assert payload.providers["openai"]["default_model"] == "claude-haiku-4-5"
    assert payload.default_provider == "moss-local"


@pytest.mark.asyncio
async def test_get_tts_config_allows_explicit_tts_feature_routing(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)
    preferences = {
        "ai_provider_settings": {
            "version": 1,
            "default_provider_id": "chat-provider",
            "providers": [
                {
                    "id": "tts-provider",
                    "name": "TTS Provider",
                    "provider": "openai",
                    "base_url": "http://127.0.0.1:3000/v1",
                    "models": ["tts-model"],
                }
            ],
            "feature_routing_settings": {
                "modules": [
                    {
                        "moduleId": "tts",
                        "currentMode": "primary",
                        "primaryTarget": {"providerId": "tts-provider", "model": "tts-model"},
                    }
                ]
            },
        }
    }
    monkeypatch.setattr(
        tts_service,
        "get_ai_settings_service",
        lambda: _AISettingsServiceStub(_SettingsStub(preferences=json.dumps(preferences))),
    )

    payload = await tts_service.build_config_response(user_id="test-user", db=object())

    assert payload.providers["openai"]["available"] is True
    assert payload.providers["openai"]["config_source"] == "feature-routing:tts"
    assert payload.providers["openai"]["default_model"] == "tts-model"
    assert payload.default_provider == "openai"


def test_list_voices_filters_by_provider() -> None:
    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/voices", params={"provider": "openai"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["voices"], "expected non-empty voices for openai"
    assert all(voice["provider"] == "openai" for voice in payload["voices"])
    assert all(voice["supports_instructions"] is True for voice in payload["voices"])
    assert {"verse", "marin", "cedar"}.issubset({voice["id"] for voice in payload["voices"]})


def test_list_voices_includes_moss_local() -> None:
    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/voices", params={"provider": "moss-local"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["voices"][0]["id"] == "demo-1"
    assert payload["voices"][0]["provider"] == "moss-local"


def test_synthesize_rejects_invalid_request_payload() -> None:
    app = _build_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/tts/synthesize",
            json={
                "text": "",
                "provider": "openai",
            },
        )

    assert response.status_code == 422


def test_synthesize_returns_stable_provider_error(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)

    app = _build_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/tts/synthesize",
            json={
                "text": "hello",
                "provider": "openai",
            },
        )

    assert response.status_code == 503
    payload = response.json()
    assert payload["detail"]["error_code"] == "missing_config"
    assert payload["detail"]["provider"] == "openai"


@pytest.mark.anyio
async def test_openai_synthesis_uses_current_default_model(monkeypatch) -> None:
    seen: dict[str, object] = {}

    monkeypatch.setenv("OPENAI_TTS_BASE_URL", "https://provider.example/v1")
    monkeypatch.setenv("OPENAI_TTS_API_KEY", "secret-key")

    async def mock_post(self, url, **kwargs):
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        seen["headers"] = kwargs.get("headers")
        return httpx.Response(
            200,
            content=b"mp3-bytes",
            headers={"content-type": "audio/mpeg"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    result = await tts_service.synthesize_tts(
        tts_service.TtsRequest(text="hello", provider="openai", instructions="calm narration")
    )

    assert result.audio_bytes == b"mp3-bytes"
    assert seen["url"] == "https://provider.example/v1/audio/speech"
    assert seen["json"]["model"] == "gpt-4o-mini-tts"
    assert seen["json"]["instructions"] == "calm narration"
    assert seen["headers"]["Authorization"] == "Bearer secret-key"


@pytest.mark.anyio
async def test_openai_synthesis_rejects_non_audio_success(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_TTS_BASE_URL", "https://provider.example/v1")

    async def mock_post(self, url, **kwargs):
        return httpx.Response(
            200,
            json={"error": "channel does not support audio"},
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    with pytest.raises(tts_service.TtsProviderError) as exc_info:
        await tts_service.synthesize_tts(tts_service.TtsRequest(text="hello", provider="openai"))

    assert exc_info.value.error_code == "provider_failed"
    assert exc_info.value.status_code == 502
    assert exc_info.value.details["content_type"] == "application/json"


@pytest.mark.anyio
async def test_moss_local_synthesis_decodes_audio_base64(monkeypatch) -> None:
    wav_bytes = b"RIFF....WAVE"
    seen: dict[str, object] = {}

    monkeypatch.setenv("MOSS_TTS_BASE_URL", "http://moss.local")

    async def mock_post(self, url, **kwargs):
        seen["url"] = url
        seen["files"] = kwargs.get("files")
        return httpx.Response(
            200,
            json={
                "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                "sample_rate": 24000,
                "normalized_text": "你好",
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    result = await tts_service.synthesize_tts(
        tts_service.TtsRequest(text="你好", provider="moss-local", voice="demo-1", seed=7)
    )

    assert result.audio_bytes == wav_bytes
    assert result.content_type == "audio/wav"
    assert seen["url"] == "http://moss.local/api/generate"
    assert seen["files"]["text"] == (None, "你好")
    assert seen["files"]["demo_id"] == (None, "demo-1")
    assert seen["files"]["seed"] == (None, "7")
    assert result.metadata["sample_rate"] == 24000


@pytest.mark.anyio
async def test_moss_local_advanced_options_map_to_generate_fields(monkeypatch) -> None:
    wav_bytes = b"RIFF....WAVE"
    seen: dict[str, object] = {}

    monkeypatch.setenv("MOSS_TTS_BASE_URL", "http://moss.local")

    async def mock_post(self, url, **kwargs):
        seen["url"] = url
        seen["files"] = kwargs.get("files")
        return httpx.Response(
            200,
            json={"audio_base64": base64.b64encode(wav_bytes).decode("ascii")},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    result = await tts_service.synthesize_tts(
        tts_service.TtsRequest(
            text="你好",
            provider="moss-local",
            advanced_options={
                "demo_id": "demo-1",
                "seed": 42,
                "normalize_text": True,
                "text_temperature": 0.7,
                "audio_temperature": 0.8,
                "top_p": 0.9,
                "top_k": 50,
                "repetition_penalty": 1.1,
            },
        )
    )

    assert result.audio_bytes == wav_bytes
    assert seen["url"] == "http://moss.local/api/generate"
    files = seen["files"]
    assert files["demo_id"] == (None, "demo-1")
    assert files["seed"] == (None, "42")
    assert files["enable_text_normalization"] == (None, "1")
    assert files["enable_normalize_tts_text"] == (None, "1")
    assert files["text_temperature"] == (None, "0.7")
    assert files["audio_temperature"] == (None, "0.8")
    assert files["text_top_p"] == (None, "0.9")
    assert files["audio_top_p"] == (None, "0.9")
    assert files["text_top_k"] == (None, "50")
    assert files["audio_top_k"] == (None, "50")
    assert files["audio_repetition_penalty"] == (None, "1.1")


@pytest.mark.anyio
async def test_moss_local_rejects_invalid_advanced_options(monkeypatch) -> None:
    monkeypatch.setenv("MOSS_TTS_BASE_URL", "http://moss.local")

    with pytest.raises(tts_service.TtsProviderError) as exc_info:
        await tts_service.synthesize_tts(
            tts_service.TtsRequest(
                text="你好",
                provider="moss-local",
                advanced_options={"seed": "abc", "top_p": 2},
            )
        )

    assert exc_info.value.error_code == "invalid_request"
    assert exc_info.value.status_code == 422
    assert exc_info.value.provider == "moss-local"
    assert exc_info.value.details["errors"]


@pytest.mark.anyio
async def test_moss_health_checks_all_required_endpoints(monkeypatch) -> None:
    seen: list[str] = []
    monkeypatch.setenv("MOSS_TTS_BASE_URL", "http://moss.local")

    async def mock_get(self, url, **kwargs):
        seen.append(url)
        return httpx.Response(200, json={"ok": True}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

    result = await tts_service.get_moss_readiness()

    assert result["ok"] is True
    assert seen == [
        "http://moss.local/health",
        "http://moss.local/api/warmup-status",
        "http://moss.local/api/text-normalization-status",
    ]


def test_synthesis_fingerprint_is_deterministic_and_sensitive_to_text() -> None:
    first = tts_service.synthesis_fingerprint(
        project_id="p1",
        chapter_id="c1",
        text="第一章内容",
        provider="moss-local",
        model=None,
        voice="demo-1",
        instructions=None,
        fmt="wav",
        speed=1.0,
    )
    second = tts_service.synthesis_fingerprint(
        project_id="p1",
        chapter_id="c1",
        text="第一章内容",
        provider="moss-local",
        model=None,
        voice="demo-1",
        instructions=None,
        fmt="wav",
        speed=1.0,
    )
    changed = tts_service.synthesis_fingerprint(
        project_id="p1",
        chapter_id="c1",
        text="第一章内容已修改",
        provider="moss-local",
        model=None,
        voice="demo-1",
        instructions=None,
        fmt="wav",
        speed=1.0,
    )

    assert first == second
    assert first != changed


def test_chunk_text_is_stable_and_respects_limit() -> None:
    text = "第一句很短。第二句也很短！第三句需要进入后续分块。"

    first = tts_service.chunk_text(text, max_chars=12)
    second = tts_service.chunk_text(text, max_chars=12)

    assert first == second
    assert all(len(chunk) <= 12 for chunk in first)
    assert "".join(chunk.replace(" ", "") for chunk in first) == text


def test_chunk_fingerprints_include_chunk_index() -> None:
    chunks = tts_service.chunk_fingerprints(
        text="第一句很短。第二句也很短！第三句也很短。",
        provider="moss-local",
        model=None,
        voice="demo-1",
        instructions=None,
        fmt="wav",
        speed=1.0,
        max_chars=12,
    )

    assert [chunk["index"] for chunk in chunks] == list(range(len(chunks)))
    assert len({chunk["fingerprint"] for chunk in chunks}) == len(chunks)


@pytest.mark.asyncio
async def test_chapter_tts_generates_local_asset_reuses_cache_and_honors_force(
    novel_main_sqlite_engine,
    tmp_path,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    await init_db_schema()

    text = "第一句适合朗读。" * 12

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-tts", user_id="test-user", title="TTS Project"))
        await db.commit()
        db.add(Chapter(id="chapter-tts", project_id="project-tts", chapter_number=1, title="第一章", content=text))
        await db.commit()

    synth_calls: list[str] = []

    async def fake_synthesize(req, **kwargs):
        synth_calls.append(req.text)
        return tts_service.TtsAudioResult(
            audio_bytes=f"RIFF-call-{len(synth_calls)}".encode("ascii"),
            content_type="audio/wav",
            provider=req.provider,
            model=req.model,
            voice=req.voice,
            metadata={"sample_rate": 24000},
        )

    async def fail_object_storage(**kwargs):
        raise ObjectStorageError("object storage is not configured")

    monkeypatch.setattr(tts_service, "synthesize_tts", fake_synthesize)
    monkeypatch.setattr(tts_service.media_asset_service, "create_asset_from_bytes", fail_object_storage)

    async with AsyncSessionLocal() as db:
        first = await tts_service.generate_chapter_tts(
            chapter_id="chapter-tts",
            req=tts_service.TtsChapterGenerateRequest(
                provider="moss-local",
                voice="demo-1",
                max_chunk_chars=80,
            ),
            user_id="test-user",
            db=db,
        )
        first_call_count = len(synth_calls)

        assert first.job.status == "completed"
        assert first.audio is not None
        assert first.audio["cache_state"] == "miss"
        assert first.audio["download_url"] == "/api/tts/chapters/chapter-tts/download"
        assert first.audio["chunks"]
        assert all(chunk["storage"] == "local_file" for chunk in first.audio["chunks"])

        manifest = await tts_service.get_chapter_audio_manifest(chapter_id="chapter-tts", user_id="test-user")
        assert manifest.status == "available"
        assert manifest.audio["chapter_id"] == "chapter-tts"

        content, media_type, filename = await tts_service.download_chapter_tts_audio(
            chapter_id="chapter-tts",
            user_id="test-user",
            db=db,
        )
        assert content.startswith(b"RIFF-call-")
        assert media_type == "audio/wav"
        assert filename == "tts_chapter-tts.wav"

        second = await tts_service.generate_chapter_tts(
            chapter_id="chapter-tts",
            req=tts_service.TtsChapterGenerateRequest(
                provider="moss-local",
                voice="demo-1",
                max_chunk_chars=80,
            ),
            user_id="test-user",
            db=db,
        )
        assert len(synth_calls) == first_call_count
        assert second.audio is not None
        assert second.audio["cache_state"] == "hit"
        assert second.cached is True

        forced = await tts_service.generate_chapter_tts(
            chapter_id="chapter-tts",
            req=tts_service.TtsChapterGenerateRequest(
                provider="moss-local",
                voice="demo-1",
                max_chunk_chars=80,
                force=True,
            ),
            user_id="test-user",
            db=db,
        )
        assert forced.job.status == "completed"
        assert len(synth_calls) > first_call_count


@pytest.mark.anyio
async def test_openai_capability_probe_classifies_provider_responses(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_TTS_BASE_URL", "https://provider.example/v1")
    cases = [
        (404, {"content-type": "application/json"}, b'{"error":"not found"}', "unsupported_endpoint", False),
        (401, {"content-type": "application/json"}, b'{"error":"bad key"}', "auth_failed", False),
        (429, {"content-type": "application/json"}, b'{"error":"rate"}', "rate_limited", False),
        (200, {"content-type": "application/json"}, b'{"ok":true}', "unsupported_endpoint", False),
        (200, {"content-type": "audio/mpeg"}, b"mp3-bytes", None, True),
    ]

    for status, headers, content, expected_code, expected_ok in cases:
        async def mock_post(self, url, **kwargs):
            return httpx.Response(
                status,
                content=content,
                headers=headers,
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

        result = await tts_service.probe_openai_speech_capability(
            tts_service.TtsCapabilityProbeRequest(provider="openai", model="gpt-4o-mini-tts")
        )

        assert result.ok is expected_ok
        assert result.endpoint == "https://provider.example/v1/audio/speech"
        assert result.error_code == expected_code


def test_probe_route_uses_env_fallback_without_database(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_TTS_BASE_URL", "https://provider.example/v1")

    async def mock_post(self, url, **kwargs):
        return httpx.Response(
            200,
            content=b"mp3-bytes",
            headers={"content-type": "audio/mpeg"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    app = _build_app()
    with TestClient(app) as client:
        response = client.post("/api/tts/probe", json={"provider": "openai"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["endpoint"] == "https://provider.example/v1/audio/speech"


@pytest.mark.anyio
async def test_download_chapter_tts_audio_maps_storage_failure(monkeypatch) -> None:
    _reset_tts_runtime_state()
    tts_service._chapter_manifests[("test-user", "chapter-storage")] = {
        "chapter_id": "chapter-storage",
        "chunks": [
            {
                "asset_id": "asset-storage",
                "storage": "media_asset",
                "chunk_index": 0,
            }
        ],
    }
    asset = MediaAsset(
        id="asset-storage",
        user_id="test-user",
        project_id="project-storage",
        purpose="tts_audio",
        filename="tts.wav",
        mime_type="audio/wav",
        size_bytes=10,
        bucket="bucket",
        object_key="missing.wav",
        status="active",
    )

    class FakeDB:
        async def get(self, model, object_id):
            assert model is MediaAsset
            assert object_id == "asset-storage"
            return asset

    async def fake_get_object(**kwargs):
        raise ObjectStorageError("storage unavailable")

    monkeypatch.setattr(tts_service.object_storage_service, "get_object", fake_get_object)

    with pytest.raises(tts_service.TtsProviderError) as exc_info:
        await tts_service.download_chapter_tts_audio(
            chapter_id="chapter-storage",
            user_id="test-user",
            db=FakeDB(),
        )

    assert exc_info.value.error_code == "storage_unavailable"
    assert exc_info.value.status_code == 503


@pytest.mark.anyio
async def test_download_chapter_tts_audio_reports_missing_ffmpeg_for_multi_chunk_mp3(monkeypatch) -> None:
    _reset_tts_runtime_state()
    monkeypatch.setattr(tts_service, "_resolve_ffmpeg_bin", lambda: None)
    tts_service._chapter_manifests[("test-user", "chapter-mp3")] = {
        "chapter_id": "chapter-mp3",
        "chunks": [
            {"asset_id": "asset-mp3-1", "storage": "local_file", "chunk_index": 0},
            {"asset_id": "asset-mp3-2", "storage": "local_file", "chunk_index": 1},
        ],
    }
    tts_service._local_audio_assets["asset-mp3-1"] = {
        "path": __file__,
        "user_id": "test-user",
        "content_type": "audio/mpeg",
    }
    tts_service._local_audio_assets["asset-mp3-2"] = {
        "path": __file__,
        "user_id": "test-user",
        "content_type": "audio/mpeg",
    }

    with pytest.raises(tts_service.TtsProviderError) as exc_info:
        await tts_service.download_chapter_tts_audio(
            chapter_id="chapter-mp3",
            user_id="test-user",
            db=object(),
        )

    assert exc_info.value.error_code == "unsupported_feature"
    assert exc_info.value.status_code == 400
    assert exc_info.value.details["media_type"] == "audio/mpeg"
    assert exc_info.value.details["chunk_count"] == 2
    assert exc_info.value.details["reason"] == "missing_ffmpeg"


@pytest.mark.anyio
async def test_download_chapter_tts_audio_exports_multi_chunk_mp3_with_ffmpeg(monkeypatch) -> None:
    _reset_tts_runtime_state()
    tts_service._chapter_manifests[("test-user", "chapter-mp3")] = {
        "chapter_id": "chapter-mp3",
        "chunks": [
            {"asset_id": "asset-mp3-1", "storage": "local_file", "chunk_index": 0},
            {"asset_id": "asset-mp3-2", "storage": "local_file", "chunk_index": 1},
        ],
    }
    tts_service._local_audio_assets["asset-mp3-1"] = {
        "path": __file__,
        "user_id": "test-user",
        "content_type": "audio/mpeg",
    }
    tts_service._local_audio_assets["asset-mp3-2"] = {
        "path": __file__,
        "user_id": "test-user",
        "content_type": "audio/mpeg",
    }

    async def fake_run_ffmpeg_concat(**kwargs):
        output_path = kwargs["output_path"]
        output_path.write_bytes(b"valid-muxed-mp3")
        return 0, b""

    monkeypatch.setattr(tts_service, "_resolve_ffmpeg_bin", lambda: "ffmpeg")
    monkeypatch.setattr(tts_service, "_run_ffmpeg_concat", fake_run_ffmpeg_concat)

    content, media_type, filename = await tts_service.download_chapter_tts_audio(
        chapter_id="chapter-mp3",
        user_id="test-user",
        db=object(),
    )

    assert content == b"valid-muxed-mp3"
    assert media_type == "audio/mpeg"
    assert filename == "tts_chapter-mp3.mp3"


@pytest.mark.asyncio
async def test_chapter_tts_uses_saved_narration_plan_for_multivoice_api_calls(
    novel_main_sqlite_engine,
    tmp_path,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-p2", user_id="test-user", title="P2 TTS Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-p2",
                project_id="project-p2",
                chapter_number=1,
                title="第一章",
                content="旁白：喵呜走进雾城。\n角色A：喵呜，你终于来了。",
            )
        )
        await db.commit()

    seen: list[tuple[str, str | None]] = []

    async def fake_synthesize(req, **kwargs):
        seen.append((req.text, req.voice))
        return tts_service.TtsAudioResult(
            audio_bytes=_wav_bytes(),
            content_type="audio/wav",
            provider=req.provider,
            model=req.model,
            voice=req.voice,
            metadata={"sample_rate": 8000},
        )

    async def fail_object_storage(**kwargs):
        raise ObjectStorageError("object storage is not configured")

    monkeypatch.setattr(tts_service, "synthesize_tts", fake_synthesize)
    monkeypatch.setattr(tts_service.media_asset_service, "create_asset_from_bytes", fail_object_storage)

    async with AsyncSessionLocal() as db:
        saved_plan = await tts_service.save_narration_plan(
            chapter_id="chapter-p2",
            user_id="test-user",
            req=tts_service.TtsNarrationPlanRequest(
                plan={
                    "plan_id": "plan-p2",
                    "chapter_id": "chapter-p2",
                    "provider": "moss-local",
                    "default_voice": "demo-1",
                    "speakers": [
                        {"id": "narrator", "display_name": "旁白", "voice": "demo-1"},
                        {"id": "character-a", "display_name": "角色A", "voice": "demo-2", "style": "年轻、警觉"},
                    ],
                    "segments": [
                        {"speaker_id": "narrator", "text": "喵呜走进雾城。", "confidence": 0.98},
                        {"speaker_id": "character-a", "text": "喵呜，你终于来了。", "instructions": "带一点惊喜", "confidence": 0.86},
                    ],
                    "confidence": 0.92,
                    "warnings": ["第二段说话人由 AI 推断"],
                }
            ),
        )
        assert saved_plan.status == "available"
        assert saved_plan.plan is not None
        assert saved_plan.plan.plan_id == "plan-p2"

        response = await tts_service.generate_chapter_tts(
            chapter_id="chapter-p2",
            req=tts_service.TtsChapterGenerateRequest(
                provider="moss-local",
                voice="demo-1",
                mode="ai_multivoice",
                plan_id="plan-p2",
                speaker_voices={"character-a": "demo-override"},
                max_chunk_chars=1200,
            ),
            user_id="test-user",
            db=db,
        )

        assert response.audio is not None
        manifest = response.audio
        assert manifest["mode"] == "ai_multivoice"
        assert manifest["plan_id"] == "plan-p2"
        assert manifest["professional_features"]["narration_plan"] is True
        assert manifest["professional_features"]["pronunciation_dictionary"] is False
        assert manifest["professional_features"]["timestamps"] is False
        assert manifest["export_urls"]["chapter"] == "/api/tts/chapters/chapter-p2/download"
        assert ("喵呜走进雾城。", "demo-1") in seen
        assert ("喵呜，你终于来了。", "demo-override") in seen
        assert any(segment["speaker_id"] == "character-a" for segment in manifest["segments"])

        manifest_path = tmp_path / "tts-assets" / "test-user" / "chapter-p2" / "manifest.json"
        plan_path = tmp_path / "tts-assets" / "test-user" / "chapter-p2" / "plans" / "plan-p2.json"
        assert manifest_path.is_file()
        assert plan_path.is_file()

        _reset_tts_runtime_state()
        loaded_plan = await tts_service.get_narration_plan(chapter_id="chapter-p2", user_id="test-user", plan_id="plan-p2")
        assert loaded_plan.status == "available"
        assert loaded_plan.plan.plan_id == "plan-p2"
        loaded = await tts_service.get_chapter_audio_manifest(chapter_id="chapter-p2", user_id="test-user")
        assert loaded.status == "available"
        assert loaded.audio["chapter_id"] == "chapter-p2"
        content, media_type, _filename = await tts_service.download_chapter_tts_audio(
            chapter_id="chapter-p2",
            user_id="test-user",
            db=db,
        )
        assert media_type == "audio/wav"
        with wave.open(BytesIO(content), "rb") as reader:
            assert reader.getnframes() > 0


@pytest.mark.asyncio
async def test_save_narration_plan_auto_plan_uses_ai_provider_json_planner(
    novel_main_sqlite_engine,
    tmp_path,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-auto-plan", user_id="test-user", title="Auto Plan Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-auto-plan",
                project_id="project-auto-plan",
                chapter_number=1,
                title="自动规划章",
                content="旁白：雾城醒来。\n角色A：我们出发。",
            )
        )
        await db.commit()

    seen: dict[str, object] = {}

    class FakeAIService:
        async def call_with_json_retry(self, **kwargs):
            seen.update(kwargs)
            return {
                "plan_id": "auto-plan-1",
                "chapter_id": "chapter-auto-plan",
                "provider": "moss-local",
                "default_voice": "demo-1",
                "speakers": [
                    {"id": "narrator", "display_name": "旁白", "voice": "demo-1"},
                    {"id": "character-a", "display_name": "角色A", "voice": "demo-2"},
                ],
                "segments": [
                    {"speaker_id": "narrator", "text": "雾城醒来。", "confidence": 0.95},
                    {"speaker_id": "character-a", "text": "我们出发。", "confidence": 0.88},
                ],
                "confidence": 0.91,
                "warnings": ["角色A由AI推断"],
            }

    async def fake_create_ai_service(db, user_id, module_id=None):
        seen["user_id"] = user_id
        seen["module_id"] = module_id
        return FakeAIService()

    monkeypatch.setattr(tts_service, "create_user_ai_service_from_db", fake_create_ai_service)

    async with AsyncSessionLocal() as db:
        response = await tts_service.save_narration_plan(
            chapter_id="chapter-auto-plan",
            user_id="test-user",
            db=db,
            req=tts_service.TtsNarrationPlanRequest(
                auto_plan=True,
                provider="moss-local",
                voice="demo-1",
            ),
        )

    assert response.status == "available"
    assert response.plan is not None
    assert response.plan.plan_id == "auto-plan-1"
    assert response.plan.speakers[1].display_name == "角色A"
    assert response.plan.segments[1].speaker_id == "character-a"
    assert seen["module_id"] == "tts_planner"
    assert seen["model"] is None
    assert seen["temperature"] == 0.1
    assert seen["max_tokens"] == 4000
    assert seen["auto_mcp"] is False
    assert seen["expected_type"] == "object"
    assert "自动规划章" in str(seen["prompt"])

    plan_path = tmp_path / "tts-assets" / "test-user" / "chapter-auto-plan" / "plans" / "auto-plan-1.json"
    assert plan_path.is_file()
    assert json.loads(plan_path.read_text(encoding="utf-8"))["plan"]["plan_id"] == "auto-plan-1"


@pytest.mark.asyncio
async def test_save_narration_plan_auto_plan_enforces_chapter_owner(
    novel_main_sqlite_engine,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-other-user", user_id="other-user", title="Other User Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-other-user",
                project_id="project-other-user",
                chapter_number=1,
                title="他人章节",
                content="不能泄露的正文",
            )
        )
        await db.commit()

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("planner must not be called for another user's chapter")

    monkeypatch.setattr(tts_service, "create_user_ai_service_from_db", fail_if_called)

    async with AsyncSessionLocal() as db:
        with pytest.raises(tts_service.TtsProviderError) as exc_info:
            await tts_service.save_narration_plan(
                chapter_id="chapter-other-user",
                user_id="test-user",
                db=db,
                req=tts_service.TtsNarrationPlanRequest(auto_plan=True),
            )

    assert exc_info.value.error_code == "invalid_request"
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_save_narration_plan_manual_plan_enforces_chapter_owner(
    novel_main_sqlite_engine,
    tmp_path,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-manual-other-user", user_id="other-user", title="Other User Manual Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-manual-other-user",
                project_id="project-manual-other-user",
                chapter_number=1,
                title="他人手工计划章节",
                content="不能写入的正文",
            )
        )
        await db.commit()

    async with AsyncSessionLocal() as db:
        with pytest.raises(tts_service.TtsProviderError) as exc_info:
            await tts_service.save_narration_plan(
                chapter_id="chapter-manual-other-user",
                user_id="test-user",
                db=db,
                req=tts_service.TtsNarrationPlanRequest(
                    plan={
                        "plan_id": "manual-plan-other-user",
                        "chapter_id": "chapter-manual-other-user",
                        "provider": "moss-local",
                        "default_voice": "demo-1",
                        "speakers": [
                            {"id": "narrator", "display_name": "旁白", "voice": "demo-1"},
                        ],
                        "segments": [
                            {"speaker_id": "narrator", "text": "不应保存。"},
                        ],
                    }
                ),
            )

    assert exc_info.value.error_code == "invalid_request"
    assert exc_info.value.status_code == 404
    plan_path = tmp_path / "tts-assets" / "test-user" / "chapter-manual-other-user" / "plans" / "manual-plan-other-user.json"
    assert not plan_path.exists()


@pytest.mark.asyncio
async def test_save_narration_plan_auto_plan_maps_missing_ai_config(
    novel_main_sqlite_engine,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-no-ai", user_id="test-user", title="No AI Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-no-ai",
                project_id="project-no-ai",
                chapter_number=1,
                title="无配置章",
                content="正文",
            )
        )
        await db.commit()

    async def fail_create_ai_service(db, user_id, module_id=None):
        raise RuntimeError("missing provider")

    monkeypatch.setattr(tts_service, "create_user_ai_service_from_db", fail_create_ai_service)

    async with AsyncSessionLocal() as db:
        with pytest.raises(tts_service.TtsProviderError) as exc_info:
            await tts_service.save_narration_plan(
                chapter_id="chapter-no-ai",
                user_id="test-user",
                db=db,
                req=tts_service.TtsNarrationPlanRequest(auto_plan=True),
            )

    assert exc_info.value.error_code == "planner_missing_config"
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_save_narration_plan_auto_plan_maps_invalid_json(
    novel_main_sqlite_engine,
    monkeypatch,
) -> None:
    _reset_tts_runtime_state()
    await init_db_schema()

    async with AsyncSessionLocal() as db:
        db.add(Project(id="project-bad-json", user_id="test-user", title="Bad JSON Project"))
        await db.commit()
        db.add(
            Chapter(
                id="chapter-bad-json",
                project_id="project-bad-json",
                chapter_number=1,
                title="坏 JSON 章",
                content="正文",
            )
        )
        await db.commit()

    class FakeAIService:
        async def call_with_json_retry(self, **kwargs):
            raise ValueError("not json")

    async def fake_create_ai_service(db, user_id, module_id=None):
        return FakeAIService()

    monkeypatch.setattr(tts_service, "create_user_ai_service_from_db", fake_create_ai_service)

    async with AsyncSessionLocal() as db:
        with pytest.raises(tts_service.TtsProviderError) as exc_info:
            await tts_service.save_narration_plan(
                chapter_id="chapter-bad-json",
                user_id="test-user",
                db=db,
                req=tts_service.TtsNarrationPlanRequest(auto_plan=True),
            )

    assert exc_info.value.error_code == "planner_invalid_json"
    assert exc_info.value.status_code == 502
