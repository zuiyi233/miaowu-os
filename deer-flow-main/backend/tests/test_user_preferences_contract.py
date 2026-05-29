from __future__ import annotations

import json
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api import user_settings
from app.gateway.novel_migrated.models.settings import Settings


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self):
        self.settings = None
        self.commit_calls = 0
        self.refresh_calls = 0

    async def execute(self, _stmt):
        return _ScalarResult(self.settings)

    def add(self, obj):
        self.settings = obj

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, _obj):
        self.refresh_calls += 1


def _build_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _inject_user(request: Request, call_next):
        request.state.user_id = "user-a"
        request.state.user = SimpleNamespace(id="user-a", system_role="user")
        return await call_next(request)

    app.include_router(user_settings.router)
    app.dependency_overrides[user_settings.get_db] = lambda: fake_db
    app.dependency_overrides[user_settings.get_config] = lambda: SimpleNamespace(
        skills=SimpleNamespace(
            get_skills_path=lambda: None,
            container_path="/mnt/skills",
            use="deerflow.skills.storage.local_skill_storage:LocalSkillStorage",
        )
    )
    return app


def test_ui_settings_defaults_and_update(monkeypatch) -> None:
    fake_db = _FakeDB()
    app = _build_app(fake_db)

    with TestClient(app) as client:
      response = client.get("/api/user/ui-settings")
      assert response.status_code == 200
      assert response.json()["media_draft_retention"] == "7d"

      update = client.put(
          "/api/user/ui-settings",
          json={"media_draft_retention": "24h"},
      )
      assert update.status_code == 200
      assert update.json()["media_draft_retention"] == "24h"


def test_skill_settings_default_all_enabled(monkeypatch) -> None:
    fake_db = _FakeDB()
    app = _build_app(fake_db)

    monkeypatch.setattr(
        user_settings,
        "_load_public_skills",
        lambda config=None: [
            SimpleNamespace(name="skill-a", description="A", license=None, category="public"),
            SimpleNamespace(name="skill-b", description="B", license=None, category="public"),
        ],
    )

    with TestClient(app) as client:
        response = client.get("/api/user/skill-settings")
        assert response.status_code == 200
        payload = response.json()
        assert [item["enabled"] for item in payload["skills"]] == [True, True]

        update = client.put(
            "/api/user/skill-settings",
            json={"enabled_skills": {"skill-a": False}},
        )
        assert update.status_code == 200
        updated = {item["name"]: item for item in update.json()["skills"]}
        assert updated["skill-a"]["enabled"] is False
        assert updated["skill-b"]["enabled"] is True


def test_tool_settings_default_all_enabled(monkeypatch) -> None:
    fake_db = _FakeDB()
    app = _build_app(fake_db)

    monkeypatch.setattr(
        user_settings.ExtensionsConfig,
        "from_file",
        classmethod(
            lambda cls: cls.model_validate(
                {
                    "mcpServers": {
                        "server-a": {"enabled": True, "type": "stdio", "description": "A"},
                        "server-b": {"enabled": True, "type": "http", "description": "B", "url": "https://example.com"},
                    }
                }
            )
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/user/tool-settings")
        assert response.status_code == 200
        payload = response.json()
        assert payload["mcp_servers"]["server-a"]["enabled"] is True
        assert payload["mcp_servers"]["server-b"]["enabled"] is True

        update = client.put(
            "/api/user/tool-settings",
            json={"enabled_mcp_servers": {"server-a": False}},
        )
        assert update.status_code == 200
        updated = update.json()["mcp_servers"]
        assert updated["server-a"]["enabled"] is False
        assert updated["server-b"]["enabled"] is True


def test_skill_and_tool_settings_persist_to_preferences(monkeypatch) -> None:
    fake_db = _FakeDB()
    app = _build_app(fake_db)

    monkeypatch.setattr(
        user_settings,
        "_load_public_skills",
        lambda config=None: [
            SimpleNamespace(name="skill-a", description="A", license=None, category="public"),
        ],
    )
    monkeypatch.setattr(
        user_settings.ExtensionsConfig,
        "from_file",
        classmethod(
            lambda cls: cls.model_validate(
                {"mcpServers": {"server-a": {"enabled": True, "type": "stdio", "description": "A"}}}
            )
        ),
    )

    with TestClient(app) as client:
        skill_update = client.put(
            "/api/user/skill-settings",
            json={"enabled_skills": {"skill-a": False}},
        )
        assert skill_update.status_code == 200

        tool_update = client.put(
            "/api/user/tool-settings",
            json={"enabled_mcp_servers": {"server-a": False}},
        )
        assert tool_update.status_code == 200

    prefs = json.loads(fake_db.settings.preferences or "{}")
    assert prefs["user_skill_settings"]["enabled_skills"]["skill-a"] is False
    assert prefs["user_tool_settings"]["enabled_mcp_servers"]["server-a"] is False
