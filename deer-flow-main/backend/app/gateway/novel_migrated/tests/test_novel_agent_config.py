"""Unit tests for novel agent configuration service and API.

Tests cover:
- CRUD operations
- Preset management (built-in + custom)
- Agent config resolution
- Input validation and sanitization
"""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.gateway.novel_migrated.models.novel_agent_config import NovelAgentConfig, NovelAgentType
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.novel_agent_config_service import (
    NovelAgentConfigService,
    _build_presets_from_deployed_models,
    _classify_models,
    _get_deployed_models,
    DEFAULT_AGENT_CONFIGS,
)


# ==================== Fixtures ====================

@pytest.fixture
def mock_db():
    """Create a mock async database session."""
    db = AsyncMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def service(mock_db):
    """Create a NovelAgentConfigService with mock db."""
    return NovelAgentConfigService(mock_db)


@pytest.fixture
def sample_config():
    """Create a sample NovelAgentConfig."""
    config = NovelAgentConfig(
        id="test-id-123",
        user_id="user-123",
        agent_type="writer",
        provider_id="openai",
        model_name="gpt-4o",
        temperature=0.7,
        max_tokens=4096,
        system_prompt="Test prompt",
        is_enabled=True,
    )
    return config


# ==================== Model Tests ====================

class TestNovelAgentConfig:
    """Tests for NovelAgentConfig model."""

    def test_to_dict(self, sample_config):
        """Test serialization to dictionary."""
        result = sample_config.to_dict()
        assert result["id"] == "test-id-123"
        assert result["user_id"] == "user-123"
        assert result["agent_type"] == "writer"
        assert result["model_name"] == "gpt-4o"
        assert result["temperature"] == 0.7
        assert result["is_enabled"] is True

    def test_agent_type_enum(self):
        """Test all agent types are defined."""
        expected = {
            "writer", "critic", "polish", "outline",
            "summary", "continue", "world_build", "character",
        }
        actual = {e.value for e in NovelAgentType}
        assert actual == expected


# ==================== Service CRUD Tests ====================

class TestNovelAgentConfigServiceCRUD:
    """Tests for CRUD operations."""

    @pytest.mark.asyncio
    async def test_get_configs(self, service, mock_db, sample_config):
        """Test getting all configs for a user."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [sample_config]
        mock_db.execute.return_value = mock_result

        configs = await service.get_configs("user-123")

        assert len(configs) == 1
        assert configs[0].agent_type == "writer"
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_config_found(self, service, mock_db, sample_config):
        """Test getting a specific config when it exists."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_config
        mock_db.execute.return_value = mock_result

        config = await service.get_config("user-123", "writer")

        assert config is not None
        assert config.model_name == "gpt-4o"

    @pytest.mark.asyncio
    async def test_get_config_not_found(self, service, mock_db):
        """Test getting a config when it doesn't exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        config = await service.get_config("user-123", "writer")

        assert config is None

    @pytest.mark.asyncio
    async def test_upsert_config_create(self, service, mock_db):
        """Test creating a new config."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        config = await service.upsert_config(
            user_id="user-123",
            agent_type="writer",
            model_name="gpt-4o",
            temperature=0.8,
            max_tokens=2048,
        )

        assert config.user_id == "user-123"
        assert config.agent_type == "writer"
        assert config.model_name == "gpt-4o"
        assert config.temperature == 0.8
        assert config.max_tokens == 2048
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_upsert_config_update(self, service, mock_db, sample_config):
        """Test updating an existing config."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_config
        mock_db.execute.return_value = mock_result

        config = await service.upsert_config(
            user_id="user-123",
            agent_type="writer",
            model_name="gpt-4o-mini",
            temperature=1.5,
        )

        assert config.model_name == "gpt-4o-mini"
        assert config.temperature == 1.5
        # Original values should be preserved
        assert config.max_tokens == 4096

    @pytest.mark.asyncio
    async def test_upsert_config_bounds(self, service, mock_db):
        """Test temperature and max_tokens bounds."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        config = await service.upsert_config(
            user_id="user-123",
            agent_type="writer",
            temperature=5.0,  # Should be clamped to 2.0
            max_tokens=100,   # Should be clamped to 512
        )

        assert config.temperature == 2.0
        assert config.max_tokens == 512

    @pytest.mark.asyncio
    async def test_delete_config_success(self, service, mock_db, sample_config):
        """Test deleting an existing config."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_config
        mock_db.execute.return_value = mock_result

        result = await service.delete_config("user-123", "writer")

        assert result is True
        mock_db.delete.assert_called_once_with(sample_config)
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_config_not_found(self, service, mock_db):
        """Test deleting a non-existent config."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await service.delete_config("user-123", "writer")

        assert result is False


# ==================== Preset Tests ====================

class TestNovelAgentConfigServicePresets:
    """Tests for preset management."""

    @pytest.mark.asyncio
    async def test_apply_preset(self, service, mock_db):
        """Test applying a preset."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._build_presets_from_deployed_models"
        ) as mock_build:
            mock_build.return_value = {
                "quality": {
                    "name": "质量优先",
                    "agent_configs": {
                        "writer": {"model_name": "gpt-4o", "temperature": 0.7},
                    },
                }
            }

            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_db.execute.return_value = mock_result

            configs = await service.apply_preset("user-123", "quality")

            assert len(configs) == 1
            assert configs[0].agent_type == "writer"
            assert configs[0].model_name == "gpt-4o"

    @pytest.mark.asyncio
    async def test_apply_preset_not_found(self, service):
        """Test applying a non-existent preset."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._build_presets_from_deployed_models"
        ) as mock_build:
            mock_build.return_value = {}

            with pytest.raises(ValueError, match="Preset not found"):
                await service.apply_preset("user-123", "nonexistent")

    @pytest.mark.asyncio
    async def test_get_presets(self, service, mock_db):
        """Test getting all presets."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._build_presets_from_deployed_models"
        ) as mock_build:
            mock_build.return_value = {
                "quality": {
                    "name": "质量优先",
                    "description": "Test",
                    "icon": "🏆",
                    "agent_configs": {},
                }
            }

            # Mock custom presets
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_db.execute.return_value = mock_result

            presets = await service.get_presets("user-123")

            assert len(presets) == 1
            assert presets[0]["id"] == "quality"
            assert presets[0]["is_built_in"] is True

    @pytest.mark.asyncio
    async def test_create_custom_preset(self, service, mock_db):
        """Test creating a custom preset."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        preset = await service.create_custom_preset(
            user_id="user-123",
            name="My Preset",
            description="Test preset",
            agent_configs={"writer": {"model_name": "gpt-4o"}},
        )

        assert preset["name"] == "My Preset"
        assert preset["description"] == "Test preset"
        assert preset["is_built_in"] is False
        assert preset["id"].startswith("custom-")

    @pytest.mark.asyncio
    async def test_delete_custom_preset(self, service, mock_db):
        """Test deleting a custom preset."""
        prefs_result = MagicMock()
        prefs_result.scalar_one_or_none.return_value = json.dumps({
            "novel_agent": {
                "custom_presets": [
                    {"id": "custom-abc123", "name": "Test"},
                ]
            }
        })
        settings_result = MagicMock()
        settings_result.scalar_one_or_none.return_value = Settings(
            user_id="user-123",
            preferences=json.dumps({
                "novel_agent": {
                    "custom_presets": [
                        {"id": "custom-abc123", "name": "Test"},
                    ]
                }
            }),
        )
        mock_db.execute.side_effect = [prefs_result, settings_result]

        result = await service.delete_custom_preset("user-123", "custom-abc123")

        assert result is True

    @pytest.mark.asyncio
    async def test_delete_custom_preset_not_found(self, service, mock_db):
        """Test deleting a non-existent custom preset."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = json.dumps({
            "novel_agent": {"custom_presets": []}
        })
        mock_db.execute.return_value = mock_result

        result = await service.delete_custom_preset("user-123", "custom-abc123")

        assert result is False


# ==================== Config Resolution Tests ====================

class TestNovelAgentConfigServiceResolution:
    """Tests for config resolution at runtime."""

    @pytest.mark.asyncio
    async def test_resolve_agent_config_custom(self, service, mock_db, sample_config):
        """Test resolving when custom config exists and is enabled."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_config
        mock_db.execute.return_value = mock_result

        config = await service.resolve_agent_config("user-123", "writer")

        assert config["source"] == "custom"
        assert config["model_name"] == "gpt-4o"
        assert config["temperature"] == 0.7

    @pytest.mark.asyncio
    async def test_resolve_agent_config_disabled(self, service, mock_db, sample_config):
        """Test resolving when custom config is disabled."""
        sample_config.is_enabled = False
        mock_result_config = MagicMock()
        mock_result_config.scalar_one_or_none.return_value = sample_config

        settings = Settings(
            user_id="user-123",
            api_provider="deepseek",
            llm_model="deepseek-chat",
        )
        mock_result_settings = MagicMock()
        mock_result_settings.scalar_one_or_none.return_value = settings

        mock_db.execute.side_effect = [mock_result_config, mock_result_settings]

        config = await service.resolve_agent_config("user-123", "writer")

        assert config["source"] == "default"
        assert config["provider_id"] == "deepseek"

    @pytest.mark.asyncio
    async def test_resolve_agent_config_fallback(self, service, mock_db):
        """Test resolving when no config exists at all."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        config = await service.resolve_agent_config("user-123", "writer")

        assert config["source"] == "fallback"
        assert config["model_name"] == "gpt-4o"
        assert config["temperature"] == DEFAULT_AGENT_CONFIGS["writer"]["temperature"]


# ==================== Dynamic Model Loading Tests ====================

class TestDynamicModelLoading:
    """Tests for dynamic model loading from deerflow config."""

    def test_get_deployed_models(self):
        """Test loading deployed models."""
        with patch("deerflow.config.get_app_config") as mock_config:
            mock_model = MagicMock()
            mock_model.name = "gpt-4o"
            mock_model.display_name = "GPT-4o"
            mock_model.use = "langchain_openai.ChatOpenAI"
            mock_model.model = "gpt-4o"

            mock_config.return_value = MagicMock(models=[mock_model])

            models = _get_deployed_models()

            assert len(models) == 1
            assert models[0]["name"] == "gpt-4o"
            assert models[0]["provider_class"] == "langchain_openai.ChatOpenAI"

    def test_get_deployed_models_empty(self):
        """Test loading when no models are configured."""
        with patch("deerflow.config.get_app_config") as mock_config:
            mock_config.return_value = MagicMock(models=[])

            models = _get_deployed_models()

            assert models == []

    def test_get_deployed_models_exception(self):
        """Test loading when config fails."""
        with patch("deerflow.config.get_app_config") as mock_config:
            mock_config.side_effect = Exception("Config error")

            models = _get_deployed_models()

            assert models == []

    def test_classify_models(self):
        """Test model classification."""
        models = [
            {"name": "gpt-4o"},
            {"name": "gpt-4o-mini"},
            {"name": "deepseek-reasoner"},
            {"name": "unknown-model"},
        ]

        classified = _classify_models(models)

        assert len(classified["strong"]) == 2  # gpt-4o + unknown-model
        assert len(classified["fast"]) == 1   # gpt-4o-mini
        assert len(classified["reasoning"]) == 1  # deepseek-reasoner

    def test_build_presets_from_deployed_models(self):
        """Test building presets from deployed models."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._get_deployed_models"
        ) as mock_get:
            mock_get.return_value = [
                {"name": "gpt-4o"},
                {"name": "gpt-4o-mini"},
                {"name": "deepseek-reasoner"},
            ]

            presets = _build_presets_from_deployed_models()

            assert "quality" in presets
            assert "speed" in presets
            assert "balanced" in presets

            # Quality preset should use strong model for writer
            assert presets["quality"]["agent_configs"]["writer"]["model_name"] == "gpt-4o"
            # Quality preset should use reasoning model for critic
            assert presets["quality"]["agent_configs"]["critic"]["model_name"] == "deepseek-reasoner"
            # Speed preset should use fast model
            assert presets["speed"]["agent_configs"]["writer"]["model_name"] == "gpt-4o-mini"

    def test_build_presets_no_models(self):
        """Test building presets when no models are deployed."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._get_deployed_models"
        ) as mock_get:
            mock_get.return_value = []

            presets = _build_presets_from_deployed_models()

            assert presets == {}


# ==================== API Validation Tests ====================

class TestAgentConfigPayload:
    """Tests for API payload validation."""

    def test_valid_agent_type(self):
        """Test valid agent type passes validation."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        payload = AgentConfigPayload(agent_type="writer")
        assert payload.agent_type == "writer"

    def test_invalid_agent_type(self):
        """Test invalid agent type fails validation."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        with pytest.raises(ValueError, match="Invalid agent_type"):
            AgentConfigPayload(agent_type="invalid_type")

    def test_temperature_bounds(self):
        """Test temperature field bounds."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        # Valid temperatures
        AgentConfigPayload(agent_type="writer", temperature=0.0)
        AgentConfigPayload(agent_type="writer", temperature=2.0)
        AgentConfigPayload(agent_type="writer", temperature=1.5)

        # Invalid temperatures should fail
        with pytest.raises(ValueError):
            AgentConfigPayload(agent_type="writer", temperature=-0.1)
        with pytest.raises(ValueError):
            AgentConfigPayload(agent_type="writer", temperature=2.1)

    def test_max_tokens_bounds(self):
        """Test max_tokens field bounds."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        # Valid values
        AgentConfigPayload(agent_type="writer", max_tokens=512)
        AgentConfigPayload(agent_type="writer", max_tokens=16000)

        # Invalid values should fail
        with pytest.raises(ValueError):
            AgentConfigPayload(agent_type="writer", max_tokens=511)
        with pytest.raises(ValueError):
            AgentConfigPayload(agent_type="writer", max_tokens=16001)

    def test_system_prompt_sanitization(self):
        """Test system prompt XSS sanitization."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        # Clean prompt should pass
        payload = AgentConfigPayload(
            agent_type="writer",
            system_prompt="You are a helpful assistant.",
        )
        assert payload.system_prompt == "You are a helpful assistant."

        # Script tag should be removed
        payload = AgentConfigPayload(
            agent_type="writer",
            system_prompt='<script>alert("xss")</script>Helpful assistant.',
        )
        assert "<script>" not in payload.system_prompt
        assert "alert" not in payload.system_prompt

        # iframe tag should be removed
        payload = AgentConfigPayload(
            agent_type="writer",
            system_prompt='<iframe src="evil.com"></iframe>Helpful.',
        )
        assert "<iframe>" not in payload.system_prompt

        # javascript: protocol should be removed
        payload = AgentConfigPayload(
            agent_type="writer",
            system_prompt="javascript:alert(1) Helpful.",
        )
        assert "javascript:" not in payload.system_prompt

        # Event handlers should be removed
        payload = AgentConfigPayload(
            agent_type="writer",
            system_prompt="<div onload=alert(1)>Helpful.</div>",
        )
        assert "onload=" not in payload.system_prompt

    def test_system_prompt_max_length(self):
        """Test system prompt max length enforcement."""
        from app.gateway.novel_migrated.api.novel_agent_configs import AgentConfigPayload

        with pytest.raises(ValueError):
            AgentConfigPayload(
                agent_type="writer",
                system_prompt="x" * 2001,
            )


# ==================== Integration Tests ====================

class TestIntegration:
    """Integration-style tests for end-to-end flows."""

    @pytest.mark.asyncio
    async def test_full_preset_flow(self, service, mock_db):
        """Test full preset application flow."""
        with patch(
            "app.gateway.novel_migrated.services.novel_agent_config_service._build_presets_from_deployed_models"
        ) as mock_build:
            mock_build.return_value = {
                "balanced": {
                    "name": "均衡模式",
                    "agent_configs": {
                        "writer": {"model_name": "gpt-4o", "temperature": 0.7},
                        "critic": {"model_name": "gpt-4o", "temperature": 0.3},
                        "polish": {"model_name": "gpt-4o", "temperature": 0.5},
                        "outline": {"model_name": "gpt-4o", "temperature": 0.7},
                    },
                }
            }

            # Build side_effect for all db.execute calls:
            # 4x get_config (upsert_config) + 1x _update_active_preset + 1x get_active_preset
            def _make_result(return_val):
                m = MagicMock()
                m.scalar_one_or_none.return_value = return_val
                return m

            side_effects = [
                _make_result(None),   # get_config writer
                _make_result(None),   # get_config critic
                _make_result(None),   # get_config polish
                _make_result(None),   # get_config outline
                _make_result(Settings(user_id="user-123", preferences="{}")),  # _update_active_preset
                _make_result(json.dumps({"novel_agent": {"active_preset": "balanced"}})),  # get_active_preset
            ]
            mock_db.execute.side_effect = side_effects

            # Apply preset
            configs = await service.apply_preset("user-123", "balanced")

            assert len(configs) == 4
            agent_types = {c.agent_type for c in configs}
            assert agent_types == {"writer", "critic", "polish", "outline"}

            # Verify active preset is set
            active = await service.get_active_preset("user-123")
            assert active == "balanced"
