"""Unit tests for Claude prompt caching configuration and behavior.

Tests the L2 provider-level caching mechanism:
- ClaudeChatModel instantiation with caching enabled
- _apply_prompt_caching() correctly marks messages
- cache_control: {type: "ephemeral"} is added to system/recent messages
- Configuration validation for enable_prompt_caching and prompt_cache_size
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch


class TestClaudeCachingConfiguration:
    """Test Claude model caching configuration."""

    def test_claude_model_with_caching_enabled(self):
        """ClaudeChatModel should accept caching configuration."""
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                model = ClaudeChatModel(
                    model="claude-sonnet-4-20250514",
                    enable_prompt_caching=True,
                    prompt_cache_size=3,
                )

                assert model.enable_prompt_caching is True
                assert model.prompt_cache_size == 3

        except ImportError:
            pytest.skip("deerflow.models.claude_provider not available")

    def test_claude_model_caching_disabled_by_default(self):
        """Prompt caching should be disabled by default if not specified."""
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                model = ClaudeChatModel(model="claude-sonnet-4-20250514")

                assert getattr(model, 'enable_prompt_caching', False) is False

        except ImportError:
            pytest.skip("deerflow.models.claude_provider not available")


class TestApplyPromptCaching:
    """Test _apply_prompt_caching() method behavior."""

    def setup_method(self):
        """Create model instance for testing."""
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                self.model = ClaudeChatModel(
                    model="claude-sonnet-4-20250514",
                    enable_prompt_caching=True,
                    prompt_cache_size=2,
                )
        except ImportError:
            self.model = None

    def test_system_message_marked_for_caching(self):
        """System message (string) should be converted to list with cache_control."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "system": "You are a helpful assistant",
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
            ],
        }

        self.model._apply_prompt_caching(payload)

        assert isinstance(payload["system"], list)
        assert len(payload["system"]) == 1
        assert payload["system"][0]["cache_control"] == {"type": "ephemeral"}

    def test_system_message_list_marked_for_caching(self):
        """System message (list) blocks should have cache_control added."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "system": [
                {"type": "text", "text": "You are helpful"},
                {"type": "text", "text": "Be concise"},
            ],
            "messages": [{"role": "user", "content": "Test"}],
        }

        self.model._apply_prompt_caching(payload)

        for block in payload["system"]:
            assert block.get("cache_control") == {"type": "ephemeral"}

    def test_recent_messages_marked_for_caching(self):
        """Last N messages (prompt_cache_size) should have cache_control."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "messages": [
                {"role": "user", "content": "Message 1"},
                {"role": "assistant", "content": "Response 1"},
                {"role": "user", "content": "Message 2"},
                {"role": "assistant", "content": "Response 2"},
            ],
        }

        self.model._apply_prompt_caching(payload)

        # Last 2 messages (prompt_cache_size=2) should be marked
        assert payload["messages"][2].get("content") == [
            {"type": "text", "text": "Message 2", "cache_control": {"type": "ephemeral"}}
        ]
        assert payload["messages"][3].get("content") == [
            {"type": "text", "text": "Response 2", "cache_control": {"type": "ephemeral"}}
        ]

    def test_older_messages_not_marked(self):
        """Messages beyond prompt_cache_size should NOT be marked."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "messages": [
                {"role": "user", "content": "Old message 1"},
                {"role": "user", "content": "Recent message"},
            ],
        }

        self.model._apply_prompt_caching(payload)

        # First message should remain unchanged (string, no cache_control)
        assert isinstance(payload["messages"][0]["content"], str)

    def test_tools_last_tool_marked(self):
        """Last tool definition should have cache_control marker."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "tools": [
                {"name": "tool1", "description": "First tool"},
                {"name": "tool2", "description": "Second tool"},
            ],
        }

        self.model._apply_prompt_caching(payload)

        assert payload["tools"][-1].get("cache_control") == {"type": "ephemeral"}
        assert "cache_control" not in payload["tools"][0]


class TestStripCacheControl:
    """Test _strip_cache_control() method for OAuth compatibility."""

    def setup_method(self):
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                self.model = ClaudeChatModel(model="claude-sonnet-4-20250514")
        except ImportError:
            self.model = None

    def test_cache_control_removed_from_system(self):
        """cache_control should be removed from system messages."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "system": [
                {"type": "text", "text": "System", "cache_control": {"type": "ephemeral"}},
            ],
        }

        self.model._strip_cache_control(payload)

        assert "cache_control" not in payload["system"][0]

    def test_cache_control_removed_from_messages(self):
        """cache_control should be removed from all message content blocks."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Hello", "cache_control": {"type": "ephemeral"}},
                    ],
                },
            ],
        }

        self.model._strip_cache_control(payload)

        assert "cache_control" not in payload["messages"][0]["content"][0]

    def test_cache_control_removed_from_tools(self):
        """cache_control should be removed from tools."""
        if not self.model:
            pytest.skip("ClaudeChatModel not available")

        payload = {
            "tools": [
                {"name": "tool1", "cache_control": {"type": "ephemeral"}},
            ],
        }

        self.model._strip_cache_control(payload)

        assert "cache_control" not in payload["tools"][0]


class TestConfigValidation:
    """Test configuration parameter validation."""

    def test_valid_prompt_cache_size(self):
        """prompt_cache_size should accept positive integers."""
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            valid_sizes = [1, 3, 5, 10]

            for size in valid_sizes:
                with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                    model = ClaudeChatModel(
                        model="claude-sonnet-4-20250514",
                        enable_prompt_caching=True,
                        prompt_cache_size=size,
                    )
                    assert model.prompt_cache_size == size

        except ImportError:
            pytest.skip("ClaudeChatModel not available")

    def test_enable_prompt_caching_boolean(self):
        """enable_prompt_caching should accept boolean values."""
        try:
            from deerflow.models.claude_provider import ClaudeChatModel

            for value in [True, False]:
                with patch("deerflow.models.claude_provider.AnthropicChatOpenAI.__init__", return_value=None):
                    model = ClaudeChatModel(
                        model="claude-sonnet-4-20250514",
                        enable_prompt_caching=value,
                    )
                    assert model.enable_prompt_caching is value

        except ImportError:
            pytest.skip("ClaudeChatModel not available")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
