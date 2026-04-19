"""Unit tests for AIService messages array format support.

Tests the new messages-based API methods added for prompt caching optimization:
- _build_messages_from_array()
- generate_text_with_messages()
- generate_text_stream_with_messages()

Also verifies backward compatibility with existing string-prompt methods.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage as LCAIMessage
from langchain_core.messages import HumanMessage, SystemMessage

from app.gateway.novel_migrated.schemas.ai_message import AiMessage
from app.gateway.novel_migrated.services.ai_service import AIService


class TestBuildMessagesFromArray:
    """Test cases for _build_messages_from_array() method."""

    def test_system_message_mapping(self):
        """System role should map to SystemMessage."""
        messages = [AiMessage(role="system", content="You are a helpful assistant.")]
        result = AIService._build_messages_from_array(messages)

        assert len(result) == 1
        assert isinstance(result[0], SystemMessage)
        assert result[0].content == "You are a helpful assistant."

    def test_user_message_mapping(self):
        """User role should map to HumanMessage."""
        messages = [AiMessage(role="user", content="Hello!")]
        result = AIService._build_messages_from_array(messages)

        assert len(result) == 1
        assert isinstance(result[0], HumanMessage)
        assert result[0].content == "Hello!"

    def test_assistant_message_mapping(self):
        """Assistant role should map to AIMessage."""
        messages = [AiMessage(role="assistant", content="Hi there!")]
        result = AIService._build_messages_from_array(messages)

        assert len(result) == 1
        assert isinstance(result[0], LCAIMessage)
        assert result[0].content == "Hi there!"

    def test_mixed_roles_conversion(self):
        """Mixed roles should all be correctly mapped."""
        messages = [
            AiMessage(role="system", content="System prompt"),
            AiMessage(role="user", content="User message"),
            AiMessage(role="assistant", content="Assistant response"),
            AiMessage(role="user", content="Follow-up question"),
        ]
        result = AIService._build_messages_from_array(messages)

        assert len(result) == 4
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[1], HumanMessage)
        assert isinstance(result[2], LCAIMessage)
        assert isinstance(result[3], HumanMessage)

    def test_empty_messages_list(self):
        """Empty messages list should return empty list."""
        messages = []
        result = AIService._build_messages_from_array(messages)

        assert result == []

    def test_unknown_role_fallback_to_user(self):
        """Unknown role should fallback to HumanMessage with warning."""
        messages = [AiMessage(role="unknown_role", content="Test content")]
        with patch("app.gateway.novel_migrated.services.ai_service.logger.warning") as mock_warning:
            result = AIService._build_messages_from_array(messages)

        assert len(result) == 1
        assert isinstance(result[0], HumanMessage)
        assert result[0].content == "Test content"
        mock_warning.assert_called_once_with("Unknown message role '%s', treating as user", "unknown_role")

    def test_case_insensitive_role_matching(self):
        """Role matching should be case-insensitive."""
        messages = [
            AiMessage(role="SYSTEM", content="Uppercase system"),
            AiMessage(role="User", content="Capitalized user"),
            AiMessage(role="ASSISTANT", content="Uppercase assistant"),
        ]
        result = AIService._build_messages_from_array(messages)

        assert len(result) == 3
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[1], HumanMessage)
        assert isinstance(result[2], LCAIMessage)

    def test_whitespace_trimmed_roles(self):
        """Roles with extra whitespace should be trimmed."""
        messages = [AiMessage(role="  user  ", content="Trimmed user")]
        result = AIService._build_messages_from_array(messages)

        assert isinstance(result[0], HumanMessage)


class TestGenerateTextWithMessages:
    """Test cases for generate_text_with_messages() method."""

    @pytest.mark.asyncio
    async def test_successful_non_streaming_call(self):
        """Test successful non-streaming generation with messages."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
        )

        mock_response = MagicMock()
        mock_response.content = "Generated text response"
        mock_response.tool_calls = []

        messages = [
            AiMessage(role="system", content="You are helpful"),
            AiMessage(role="user", content="Hello"),
        ]

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=None):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.ainvoke = AsyncMock(return_value=mock_response)
            mock_create.return_value = mock_llm

            result = await ai_service.generate_text_with_messages(
                messages=messages,
                model="gpt-4o",
                temperature=0.5,
                max_tokens=1000,
            )

            assert result["content"] == "Generated text response"
            assert result["finish_reason"] == "stop"
            assert result["tool_calls"] == []
            mock_llm.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_mcp_tools_binding(self):
        """Test that MCP tools are properly bound when available."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
            enable_mcp=True,
        )

        mock_tools = [MagicMock()]
        mock_response = MagicMock()
        mock_response.content = "Response with tools"
        mock_response.tool_calls = []

        messages = [AiMessage(role="user", content="Use tools")]

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=mock_tools):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.ainvoke = AsyncMock(return_value=mock_response)
            mock_create.return_value = mock_llm

            await ai_service.generate_text_with_messages(messages=messages)

            mock_llm.bind_tools.assert_called_once_with(mock_tools)


class TestGenerateTextStreamWithMessages:
    """Test cases for generate_text_stream_with_messages() method."""

    @pytest.mark.asyncio
    async def test_successful_streaming(self):
        """Test successful streaming generation with messages."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
        )

        messages = [
            AiMessage(role="system", content="You are helpful"),
            AiMessage(role="user", content="Stream this"),
        ]

        mock_chunks = [
            LCAIMessage(content="Hello "),
            LCAIMessage(content="world"),
            LCAIMessage(content="!"),
        ]

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=None):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.astream = AsyncMock(return_value=iter(mock_chunks))
            mock_create.return_value = mock_llm

            collected_chunks = []
            async for chunk in ai_service.generate_text_stream_with_messages(
                messages=messages,
                model="gpt-4o",
            ):
                collected_chunks.append(chunk)

            assert collected_chunks == ["Hello ", "world", "!"]

    @pytest.mark.asyncio
    async def test_empty_stream_handling(self):
        """Test handling of empty stream chunks."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
        )

        messages = [AiMessage(role="user", content="Test")]

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=None):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.astream = AsyncMock(return_value=iter([LCAIMessage(content="")]))
            mock_create.return_value = mock_llm

            collected_chunks = []
            async for chunk in ai_service.generate_text_stream_with_messages(messages=messages):
                collected_chunks.append(chunk)

            assert collected_chunks == []


class TestBackwardCompatibility:
    """Verify backward compatibility with existing string-prompt methods."""

    @pytest.mark.asyncio
    async def test_generate_text_still_works(self):
        """Original generate_text() with string prompt should still work."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
        )

        mock_response = MagicMock()
        mock_response.content = "Traditional response"
        mock_response.tool_calls = []

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=None):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.ainvoke = AsyncMock(return_value=mock_response)
            mock_create.return_value = mock_llm

            result = await ai_service.generate_text(prompt="Hello")

            assert result["content"] == "Traditional response"
            assert "finish_reason" in result

    @pytest.mark.asyncio
    async def test_generate_text_stream_still_works(self):
        """Original generate_text_stream() should still work."""
        ai_service = AIService(
            api_provider="openai",
            api_key="test-key",
            api_base_url="https://api.openai.com/v1",
            default_model="gpt-4o",
            default_temperature=0.7,
            default_max_tokens=2000,
        )

        with patch.object(ai_service, "_resolve_model_name", return_value="gpt-4o"), \
             patch("app.gateway.novel_migrated.services.ai_service.create_chat_model") as mock_create, \
             patch.object(ai_service, "_prepare_mcp_tools", new_callable=AsyncMock, return_value=None):

            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm.astream = AsyncMock(return_value=iter([LCAIMessage(content="Stream")]))
            mock_create.return_value = mock_llm

            chunks = []
            async for chunk in ai_service.generate_text_stream(prompt="Test"):
                chunks.append(chunk)

            assert chunks == ["Stream"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
