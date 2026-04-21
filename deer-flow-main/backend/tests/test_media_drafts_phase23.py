from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.gateway.routers import media_drafts, threads


@pytest.fixture(autouse=True)
def _reset_media_draft_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        media_drafts,
        "_MEDIA_DRAFT_METRICS",
        {key: 0 for key in media_drafts._MEDIA_DRAFT_METRICS},
    )


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, execute_results: list[object], *, commit_exc: Exception | None = None):
        self._results = list(execute_results)
        self._commit_exc = commit_exc
        self.commit_calls = 0

    async def execute(self, _stmt):
        value = self._results.pop(0) if self._results else None
        return _ScalarResult(value)

    async def commit(self):
        self.commit_calls += 1
        if self._commit_exc is not None:
            raise self._commit_exc


def _build_attach_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()
    app.include_router(media_drafts.router)
    app.dependency_overrides[media_drafts.get_db] = lambda: fake_db
    return app


def _patch_common_auth(monkeypatch: pytest.MonkeyPatch, *, verify_fn):
    monkeypatch.setattr("app.gateway.novel_migrated.api.common.get_user_id", lambda _request: "user-1")
    monkeypatch.setattr("app.gateway.novel_migrated.api.common.verify_project_access", verify_fn)


def _patch_attach_success(monkeypatch: pytest.MonkeyPatch, *, kind: str = "image") -> dict[str, object]:
    calls: dict[str, object] = {"attach": [], "patch": []}

    def _attach(**kwargs):
        calls["attach"].append(kwargs)
        return {
            "asset_id": "asset-1",
            "kind": kind,
            "mime_type": "image/png",
            "content_url": "https://cdn.test/asset-1.png",
        }

    async def _patch_thread_draft_media(**kwargs):
        calls["patch"].append(kwargs)

    monkeypatch.setattr(media_drafts.draft_media_store, "attach_draft_to_asset", _attach)
    monkeypatch.setattr(media_drafts, "_patch_thread_draft_media", _patch_thread_draft_media)
    return calls


def test_attach_project_validation_failure_does_not_call_attach(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _deny_access(*_args, **_kwargs):
        raise HTTPException(status_code=403, detail="forbidden")

    _patch_common_auth(monkeypatch, verify_fn=_deny_access)
    calls = _patch_attach_success(monkeypatch)
    app = _build_attach_app(_FakeDB(execute_results=[]))

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "project", "target_id": "project-1"},
        )

    assert response.status_code == 403
    assert calls["attach"] == []
    assert calls["patch"] == []


def test_attach_character_validation_failure_does_not_call_attach(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    calls = _patch_attach_success(monkeypatch)
    app = _build_attach_app(_FakeDB(execute_results=[None]))

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "character", "target_id": "character-missing"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Character not found"
    assert calls["attach"] == []
    assert calls["patch"] == []


def test_attach_scene_existing_target_should_succeed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    _patch_attach_success(monkeypatch, kind="image")
    scene_updates: list[tuple[str, dict[str, object]]] = []

    async def _get_scene(entity_id: str):
        return {"id": entity_id, "type": "setting", "properties": {}}

    async def _update_scene(entity_id: str, updates: dict[str, object]):
        scene_updates.append((entity_id, updates))
        return {"id": entity_id, **updates}

    monkeypatch.setattr("app.gateway.routers.novel.get_legacy_entity_by_id", _get_scene)
    monkeypatch.setattr("app.gateway.routers.novel.update_legacy_entity_by_id", _update_scene)
    app = _build_attach_app(_FakeDB(execute_results=[]))

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "scene", "target_id": "scene-1"},
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["target_updated"] is True
    assert scene_updates
    assert scene_updates[0][0] == "scene-1"
    assert scene_updates[0][1]["image_url"] == "https://cdn.test/asset-1.png"


def test_attach_scene_missing_target_should_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    calls = _patch_attach_success(monkeypatch)

    async def _get_scene(_entity_id: str):
        return None

    monkeypatch.setattr("app.gateway.routers.novel.get_legacy_entity_by_id", _get_scene)
    app = _build_attach_app(_FakeDB(execute_results=[]))

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "scene", "target_id": "scene-missing"},
        )

    assert response.status_code == 404
    assert "scene" in response.json()["detail"].lower()
    assert calls["attach"] == []
    assert calls["patch"] == []


def test_media_draft_metrics_endpoint_counts_scene_attach(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    _patch_attach_success(monkeypatch, kind="image")

    async def _get_scene(entity_id: str):
        return {"id": entity_id, "type": "scene", "properties": {}}

    async def _update_scene(entity_id: str, updates: dict[str, object]):
        return {"id": entity_id, **updates}

    monkeypatch.setattr("app.gateway.routers.novel.get_legacy_entity_by_id", _get_scene)
    monkeypatch.setattr("app.gateway.routers.novel.update_legacy_entity_by_id", _update_scene)
    app = _build_attach_app(_FakeDB(execute_results=[]))

    with TestClient(app) as client:
        attach_response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "scene", "target_id": "scene-1"},
        )
        metrics_response = client.get("/api/media/drafts/metrics")

    assert attach_response.status_code == 200
    assert metrics_response.status_code == 200
    metrics = metrics_response.json()["metrics"]
    assert metrics["attach_requests_total"] == 1
    assert metrics["attach_success_total"] == 1
    assert metrics["attach_scene_success_total"] == 1
    assert metrics["attach_target_update_failed_total"] == 0


def test_attach_target_updated_true_when_sync_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    calls = _patch_attach_success(monkeypatch, kind="image")
    project = SimpleNamespace(id="project-1", cover_image_url=None, cover_status=None, cover_updated_at=None)
    fake_db = _FakeDB(execute_results=[project, project])
    app = _build_attach_app(fake_db)

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "project", "target_id": "project-1"},
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["target_updated"] is True
    assert payload["target_update_error"] is None
    assert fake_db.commit_calls == 1
    assert project.cover_image_url == "https://cdn.test/asset-1.png"
    assert project.cover_status == "ready"
    assert calls["attach"]
    assert calls["patch"]


def test_attach_target_updated_false_when_sync_write_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _allow_access(*_args, **_kwargs):
        return None

    _patch_common_auth(monkeypatch, verify_fn=_allow_access)
    _patch_attach_success(monkeypatch, kind="image")
    project = SimpleNamespace(id="project-1", cover_image_url=None, cover_status=None, cover_updated_at=None)
    fake_db = _FakeDB(execute_results=[project, project], commit_exc=RuntimeError("db commit failed"))
    app = _build_attach_app(fake_db)

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/thread-1/media/drafts/draft-1/attach",
            json={"target_type": "project", "target_id": "project-1"},
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["target_updated"] is False
    assert "db commit failed" in str(payload["target_update_error"])
    assert fake_db.commit_calls == 1


def test_cleanup_expired_channel_values_filters_expired_draft_media_and_triggers_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleanup_calls: list[str] = []

    def _cleanup_expired(*, thread_id: str) -> None:
        cleanup_calls.append(thread_id)

    monkeypatch.setattr(threads.draft_media_store, "cleanup_expired", _cleanup_expired)

    channel_values = {
        "draft_media": {
            "expired": {"expires_at": "2000-01-01T00:00:00Z"},
            "alive": {"expires_at": "2999-01-01T00:00:00Z"},
            "without_expire": {"kind": "image"},
        }
    }

    result, changed = threads._cleanup_expired_channel_values("thread-1", channel_values)

    assert cleanup_calls == ["thread-1"]
    assert changed is True
    assert "draft_media" in result
    assert "expired" not in result["draft_media"]
    assert "alive" in result["draft_media"]
    assert "without_expire" in result["draft_media"]


def test_cleanup_expired_channel_values_keeps_filtering_when_cleanup_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def _cleanup_expired(*, thread_id: str) -> None:
        raise RuntimeError(f"cleanup failed for {thread_id}")

    monkeypatch.setattr(threads.draft_media_store, "cleanup_expired", _cleanup_expired)

    channel_values = {
        "draft_media": {
            "expired": {"expires_at": "2000-01-01T00:00:00Z"},
            "alive": {"expires_at": "2999-01-01T00:00:00Z"},
        }
    }

    result, changed = threads._cleanup_expired_channel_values("thread-2", channel_values)

    assert changed is True
    assert "draft_media" in result
    assert set(result["draft_media"].keys()) == {"alive"}


def test_persist_cleaned_draft_media_checkpoint_writes_new_checkpoint() -> None:
    class _FakeCheckpointer:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        async def aput(self, cfg, checkpoint, metadata, _writes):  # noqa: ANN001
            self.calls.append(
                {
                    "cfg": cfg,
                    "checkpoint": checkpoint,
                    "metadata": metadata,
                }
            )

    checkpoint_tuple = SimpleNamespace(
        checkpoint={"channel_values": {"draft_media": {"expired": {"expires_at": "2000-01-01T00:00:00Z"}}}},
        metadata={"created_at": "2024-01-01T00:00:00Z", "step": 1},
    )
    checkpointer = _FakeCheckpointer()
    cleaned_values = {"draft_media": {"alive": {"expires_at": "2999-01-01T00:00:00Z"}}}

    asyncio.run(
        threads._persist_cleaned_draft_media_checkpoint(
            checkpointer=checkpointer,
            thread_id="thread-3",
            checkpoint_tuple=checkpoint_tuple,
            channel_values=cleaned_values,
            as_node="tests.cleanup",
        )
    )

    assert len(checkpointer.calls) == 1
    write = checkpointer.calls[0]
    assert write["cfg"] == {"configurable": {"thread_id": "thread-3", "checkpoint_ns": ""}}
    assert write["checkpoint"]["channel_values"] == cleaned_values
    assert write["metadata"]["writes"] == {"tests.cleanup": {"draft_media": {"_expired_removed": True}}}
