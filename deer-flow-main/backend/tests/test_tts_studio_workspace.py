from __future__ import annotations

import io
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.routers import tts as tts_router
from app.gateway.routers.tts_support import service as tts_service


def _build_app(user_id: str | None = "studio-user") -> FastAPI:
    app = FastAPI()
    app.include_router(tts_router.router)
    if user_id is not None:
        app.dependency_overrides[get_user_id] = lambda: user_id
    return app


def test_tts_studio_requires_authentication() -> None:
    app = _build_app(user_id=None)
    with TestClient(app) as client:
        response = client.get("/api/tts/studio/workspaces")

    assert response.status_code == 401


def test_tts_studio_crud_and_ownership(novel_main_sqlite_engine) -> None:
    app = _build_app("studio-user-a")
    with TestClient(app) as client:
        created = client.post("/api/tts/studio/workspaces", json={"name": "Studio A"})
        assert created.status_code == 200
        workspace = created.json()
        workspace_id = workspace["id"]
        assert workspace["name"] == "Studio A"
        assert workspace["board"]["nodes"]

        listed = client.get("/api/tts/studio/workspaces")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["items"]] == [workspace_id]

        updated = client.put(
            f"/api/tts/studio/workspaces/{workspace_id}",
            json={
                "name": "Renamed",
                "board": {
                    "version": 1,
                    "nodes": [{"id": "prompt-1", "type": "prompt", "position": {"x": 1, "y": 2}, "data": {"text": "hello"}}],
                    "edges": [],
                    "stash": [],
                },
            },
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Renamed"
        assert updated.json()["board"]["nodes"][0]["data"]["text"] == "hello"

    other_app = _build_app("studio-user-b")
    with TestClient(other_app) as client:
        forbidden = client.get(f"/api/tts/studio/workspaces/{workspace_id}")
        assert forbidden.status_code == 404

    with TestClient(app) as client:
        deleted = client.delete(f"/api/tts/studio/workspaces/{workspace_id}")
        assert deleted.status_code == 200
        assert client.get(f"/api/tts/studio/workspaces/{workspace_id}").status_code == 404


def test_tts_studio_run_node_and_export(novel_main_sqlite_engine, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    tts_service._local_audio_assets.clear()

    async def fake_design(req, *, user_id, db=None):
        return await tts_service._persist_generated_tts_audio(
            user_id=user_id,
            result=tts_service.TtsAudioResult(
                audio_bytes=b"studio-audio",
                content_type="audio/mpeg",
                provider="mimo",
                model=req.model or "mimo-test",
                voice="mimo-voice",
            ),
            kind="voice_design",
            metadata={"voice_description": req.voice_description},
        )

    monkeypatch.setattr("app.gateway.routers.tts_support.studio.design_tts_voice", fake_design)

    app = _build_app("studio-runner")
    with TestClient(app) as client:
        created = client.post(
            "/api/tts/studio/workspaces",
            json={
                "name": "Run Studio",
                "board": {
                    "version": 1,
                    "nodes": [
                        {"id": "prompt-1", "type": "prompt", "position": {"x": 0, "y": 0}, "data": {"text": "试听文本"}},
                        {"id": "design-1", "type": "voiceDesign", "position": {"x": 200, "y": 0}, "data": {"voice_description": "温柔旁白"}},
                    ],
                    "edges": [{"id": "prompt-design", "source": "prompt-1", "target": "design-1"}],
                    "stash": [],
                },
            },
        )
        assert created.status_code == 200
        workspace_id = created.json()["id"]

        run = client.post(f"/api/tts/studio/workspaces/{workspace_id}/run-node", json={"node_id": "design-1"})
        assert run.status_code == 200
        payload = run.json()
        asset_id = payload["artifact"]["asset_id"]
        assert asset_id
        assert payload["workspace"]["board"]["stash"][0]["asset_id"] == asset_id

        exported = client.post(
            f"/api/tts/studio/workspaces/{workspace_id}/export",
            json={"asset_ids": [asset_id]},
        )
        assert exported.status_code == 200
        assert exported.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            names = archive.namelist()
            assert any(name.endswith(".mp3") for name in names)
            assert archive.read(names[0]) == b"studio-audio"


def test_tts_studio_voice_style_alias_is_accepted(novel_main_sqlite_engine, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("MIAOWU_TTS_ASSET_DIR", str(tmp_path / "tts-assets"))
    tts_service._local_audio_assets.clear()
    seen: dict[str, str | None] = {}

    async def fake_clone(req, *, user_id, db=None):
        seen["reference_audio_data_url"] = req.reference_audio_data_url
        seen["reference_audio_asset_id"] = req.reference_audio_asset_id
        return await tts_service._persist_generated_tts_audio(
            user_id=user_id,
            result=tts_service.TtsAudioResult(
                audio_bytes=b"clone-audio",
                content_type="audio/mpeg",
                provider="mimo",
                model=req.model or "mimo-test",
                voice="mimo-voice",
            ),
            kind="voice_clone",
            metadata={"style": req.style},
        )

    monkeypatch.setattr("app.gateway.routers.tts_support.studio.clone_tts_voice", fake_clone)
    reference_path = tmp_path / "reference.wav"
    reference_path.write_bytes(b"reference-audio")
    tts_service._local_audio_assets["asset-1"] = {
        "path": str(reference_path),
        "user_id": "studio-style",
        "project_id": None,
        "chapter_id": None,
        "filename": "reference.wav",
        "content_type": "audio/wav",
        "size_bytes": len(b"reference-audio"),
        "fingerprint": "reference",
        "metadata": {},
    }

    app = _build_app("studio-style")
    with TestClient(app) as client:
        created = client.post(
            "/api/tts/studio/workspaces",
            json={
                "name": "Style Alias",
                "board": {
                    "version": 1,
                    "nodes": [
                        {"id": "reference-1", "type": "referenceAudio", "position": {"x": 0, "y": 0}, "data": {"asset_id": "asset-1"}},
                        {"id": "style-1", "type": "voiceStyle", "position": {"x": 0, "y": 120}, "data": {"style_text": "温柔、干净"}},
                        {"id": "clone-1", "type": "voiceClone", "position": {"x": 200, "y": 0}, "data": {"reference_audio_asset_id": "asset-1", "text": "你好"}},
                    ],
                    "edges": [
                        {"id": "reference-clone", "source": "reference-1", "target": "clone-1"},
                        {"id": "style-clone", "source": "style-1", "target": "clone-1"},
                    ],
                    "stash": [],
                },
            },
        )
        workspace_id = created.json()["id"]
        run = client.post(f"/api/tts/studio/workspaces/{workspace_id}/run-node", json={"node_id": "clone-1"})
        assert run.status_code == 200
        assert run.json()["artifact"]["metadata"]["style"] == "温柔、干净"
        assert seen["reference_audio_data_url"].startswith("data:audio/wav;base64,")
        assert seen["reference_audio_asset_id"] is None


def test_tts_studio_export_reports_no_assets(novel_main_sqlite_engine) -> None:
    app = _build_app("studio-empty-export")
    with TestClient(app) as client:
        created = client.post("/api/tts/studio/workspaces", json={"name": "Empty"})
        workspace_id = created.json()["id"]
        exported = client.post(f"/api/tts/studio/workspaces/{workspace_id}/export", json={"asset_ids": []})

    assert exported.status_code == 400
    assert exported.json()["detail"]["error_code"] == "no_assets"


def test_tts_studio_rejects_inline_audio_data(novel_main_sqlite_engine) -> None:
    app = _build_app("studio-inline-audio")
    with TestClient(app) as client:
        response = client.post(
            "/api/tts/studio/workspaces",
            json={
                "name": "Inline Audio",
                "board": {
                    "version": 1,
                    "nodes": [
                        {
                            "id": "reference-1",
                            "type": "referenceAudio",
                            "position": {"x": 0, "y": 0},
                            "data": {"reference_audio_data_url": "data:audio/wav;base64,AAAA"},
                        }
                    ],
                    "edges": [],
                    "stash": [],
                },
            },
        )

    assert response.status_code == 422


def test_tts_studio_rejects_too_many_nodes(novel_main_sqlite_engine) -> None:
    app = _build_app("studio-too-large")
    nodes = [
        {"id": f"prompt-{index}", "type": "prompt", "position": {"x": index, "y": 0}, "data": {"text": "hello"}}
        for index in range(101)
    ]
    with TestClient(app) as client:
        response = client.post(
            "/api/tts/studio/workspaces",
            json={
                "name": "Too Large",
                "board": {"version": 1, "nodes": nodes, "edges": [], "stash": []},
            },
        )

    assert response.status_code == 422
