"""novel_migrated P2 补齐 - 单元测试

覆盖范围：
- 新增 API 模块：prompt_templates, prompt_workshop, admin, changelog
- 新增服务层：workshop_client, oauth_service, email_service, ai_service增强, prompt_service增强
- 新增数据模型：prompt_workshop, user

运行方式：
  PYTHONPATH=. uv run pytest tests/test_novel_p2_fix.py -v
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

logger = logging.getLogger(__name__)


# ==================== 测试数据模型 ====================

class TestPromptWorkshopModels:
    """测试提示词工坊数据模型"""

    def test_prompt_workshop_item_creation(self):
        """测试 PromptWorkshopItem 模型创建"""
        from app.gateway.novel_migrated.models.prompt_workshop import PromptWorkshopItem

        item = PromptWorkshopItem(
            id="test-001",
            name="测试提示词",
            description="这是一个测试提示词",
            prompt_content="你是一个有帮助的助手",
            category="general",
            tags=["测试", "示例"],
            author_name="测试作者",
            is_official=False,
        )

        assert item.id == "test-001"
        assert item.name == "测试提示词"
        assert item.status == "active"  # 默认值
        assert item.download_count == 0  # 默认值
        assert item.like_count == 0  # 默认值
        assert repr(item) == "<PromptWorkshopItem(id=test-001, name=测试提示词)>"

    def test_prompt_submission_creation(self):
        """测试 PromptSubmission 模型创建"""
        from app.gateway.novel_migrated.models.prompt_workshop import PromptSubmission

        submission = PromptSubmission(
            id="sub-001",
            submitter_id="user:123",
            submitter_name="测试用户",
            source_instance="local",
            name="提交的提示词",
            prompt_content="内容",
            category="custom",
            status="pending",  # 默认值
        )

        assert submission.id == "sub-001"
        assert submission.status == "pending"
        assert submission.is_anonymous is False  # 默认值

    def test_prompt_workshop_like_creation(self):
        """测试 PromptWorkshopLike 模型创建"""
        from app.gateway.novel_migrated.models.prompt_workshop import PromptWorkshopLike

        like = PromptWorkshopLike(
            id="like-001",
            user_identifier="user:123",
            workshop_item_id="test-001",
        )

        assert like.id == "like-001"
        assert like.user_identifier == "user:123"
        assert like.workshop_item_id == "test-001"


class TestUserModels:
    """测试用户数据模型"""

    def test_user_model_creation(self):
        """测试 User 模型创建"""
        from app.gateway.novel_migrated.models.user import User

        user = User(
            user_id="test-user-001",
            username="testuser",
            display_name="测试用户",
            trust_level=0,
            is_admin=False,
            linuxdo_id="test-user-001",
        )

        assert user.user_id == "test-user-001"
        assert user.is_active is True  # trust_level != -1
        assert user.to_dict()["username"] == "testuser"
        assert user.to_dict()["is_active"] is True

    def test_user_model_disabled(self):
        """测试禁用用户"""
        from app.gateway.novel_migrated.models.user import User

        user = User(
            user_id="disabled-user",
            username="disabled",
            display_name="禁用用户",
            trust_level=-1,  # 禁用状态
        )

        assert user.is_active is False

    def test_user_password_model(self):
        """测试 UserPassword 模型"""
        from app.gateway.novel_migrated.models.user import UserPassword

        pwd = UserPassword(
            user_id="test-user",
            username="testuser",
            password_hash=hashlib.sha256("password123".encode()).hexdigest(),
        )

        assert pwd.user_id == "test-user"
        assert pwd.has_custom_password is False  # 默认值


# ==================== 测试服务层 ====================

class TestWorkshopClient:
    """测试工坊客户端"""

    def test_client_initialization(self):
        """测试客户端初始化"""
        from app.gateway.novel_migrated.services.workshop_client import WorkshopClient, WorkshopClientError

        client = WorkshopClient(
            base_url="https://example.com",
            timeout=30.0,
            instance_id="test-instance",
        )

        assert client.base_url == "https://example.com"
        assert client.timeout == 30.0
        assert client.instance_id == "test-instance"

    def test_workshop_client_error(self):
        """测试工坊客户端错误异常"""
        from app.gateway.novel_migrated.services.workshop_client import WorkshopClientError

        error = WorkshopClientError("连接失败")
        assert str(error) == "连接失败"
        assert isinstance(error, Exception)


class TestOAuthService:
    """测试 OAuth 服务"""

    def test_oauth_state_generation(self):
        """测试 state 参数生成"""
        from app.gateway.novel_migrated.services.oauth_service import BaseOAuthService

        service = BaseOAuthService()
        state1 = service.generate_state()
        state2 = service.generate_state()

        assert state1 != state2  # 每次应该不同
        assert len(state1) > 20  # 足够长的随机字符串

    def test_authorization_url_generation(self):
        """测试授权 URL 生成"""
        from app.gateway.novel_migrated.services.oauth_service import BaseOAuthService

        service = BaseOAuthService(
            client_id="test-client-id",
            client_secret="test-secret",
            redirect_uri="http://localhost:8000/callback",
        )

        url = service.get_authorization_url("test-state-123")

        assert "client_id=test-client-id" in url
        assert "redirect_uri=http://localhost:8000/callback" in url
        assert "state=test-state-123" in url
        assert "response_type=code" in url


class TestEmailService:
    """测试邮件服务"""

    def test_email_service_availability(self):
        """测试邮件服务可用性检查"""
        from app.gateway.novel_migrated.services.email_service import email_service

        # 检查服务实例是否存在
        assert email_service is not None

    def test_email_masking(self):
        """测试邮箱脱敏"""
        from app.gateway.novel_migrated.services.email_service import EmailService

        assert EmailService._mask_email("test@example.com") == "t**t@example.com"
        assert EmailService._mask_email("ab@example.com") == "a*@example.com"
        assert EmailService._mask_email("invalid") == "invalid"


# ==================== 测试 AI 服务增强 ====================

class TestAIServiceEnhancements:
    """测试 AI 服务增强功能"""

    def test_model_cache_stats_initial(self):
        """测试模型缓存统计初始状态"""
        from app.gateway.novel_migrated.services.ai_service import get_model_cache_stats

        stats = get_model_cache_stats()
        assert stats["cache_size"] >= 0
        assert isinstance(stats["models"], dict)

    def test_call_stats_initial(self):
        """测试调用统计初始状态"""
        from app.gateway.novel_migrated.services.ai_service import get_call_stats

        stats = get_call_stats()
        assert isinstance(stats, dict)

    def test_normalize_provider(self):
        """测试 provider 标准化"""
        from app.gateway.novel_migrated.services.ai_service import normalize_provider

        assert normalize_provider("mumu") == "openai"
        assert normalize_provider("openai") == "openai"
        assert normalize_provider(None) is None
        assert normalize_provider("anthropic") == "anthropic"


# ==================== 测试 PromptService 增强 ====================

class TestPromptServiceEnhancements:
    """测试 PromptService 增强方法"""

    def test_apply_style_to_prompt(self):
        """测试应用写作风格"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        base = "请写一个故事"
        styled = PromptService.apply_style_to_prompt(base, "古风", "文言文风格")

        assert "古风" in styled
        assert base in styled
        assert "writing_style" in styled

    def test_build_novel_cover_prompt(self):
        """测试封面提示词构建"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        prompt = PromptService.build_novel_cover_prompt(
            title="测试小说",
            genre="玄幻",
            theme="修仙",
            description="一个修仙的故事",
        )

        assert "测试小说" in prompt
        assert "玄幻" in prompt
        assert "修仙" in prompt

    def test_get_chapter_regeneration_prompt(self):
        """测试章节重写提示词"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        prompt = PromptService.get_chapter_regeneration_prompt(
            chapter_title="第一章",
            chapter_outline="主角出发冒险",
            regeneration_reason="质量不佳",
        )

        assert "第一章" in prompt
        assert "主角出发冒险" in prompt
        assert "质量不佳" in prompt

    def test_get_mcp_tool_test_prompts(self):
        """测试 MCP 工具测试提示词"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        prompts = PromptService.get_mcp_tool_test_prompts()

        assert isinstance(prompts, dict)
        assert "weather_test" in prompts
        assert "search_test" in prompts
        assert len(prompts) >= 5

    def test_get_all_system_templates(self):
        """测试获取所有系统模板"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        templates = PromptService.get_all_system_templates()

        assert isinstance(templates, list)
        assert len(templates) > 0  # 应该有内置模板

        for template in templates:
            assert "template_key" in template
            assert "template_name" in template
            assert "content" in template
            assert "category" in template

    def test_get_system_template_info_existing(self):
        """测试获取存在的系统模板信息"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        info = PromptService.get_system_template_info("WORLD_BUILDING")

        assert info is not None
        assert info["template_key"] == "WORLD_BUILDING"
        assert len(info["content"]) > 0

    def test_get_system_template_info_nonexistent(self):
        """测试获取不存在的系统模板信息"""
        from app.gateway.novel_migrated.services.prompt_service import PromptService

        info = PromptService.get_system_template_info("NONEXISTENT_TEMPLATE")

        assert info is None


# ==================== 辅助函数测试 ====================

class TestHelperFunctions:
    """测试辅助函数"""

    def test_infer_template_category(self):
        """测试模板分类推断"""
        from app.gateway.novel_migrated.services.prompt_service import _infer_template_category

        assert _infer_template_category("WORLD_BUILDING") == "世界构建"
        assert _infer_template_category("CAREER_SYSTEM") == "职业体系"
        assert _infer_template_category("CHARACTER_CREATE") == "角色创建"
        assert _infer_template_category("UNKNOWN_TEMPLATE") == "通用"

    def test_extract_template_parameters(self):
        """测试模板参数提取"""
        from app.gateway.novel_migrated.services.prompt_service import _extract_template_parameters

        params = _extract_template_parameters("你好 {name}，欢迎来到 {city}！")

        assert len(params) == 2
        param_names = [p["name"] for p in params]
        assert "name" in param_names
        assert "city" in param_names


# ==================== 集成测试：路由注册 ====================

class TestRouterRegistration:
    """测试路由注册完整性"""

    def test_novel_migrated_router_exists(self):
        """测试主路由器存在"""
        from app.gateway.routers.novel_migrated import router

        assert router is not None
        assert router.tags == ["novel_migrated"]

    def test_optional_modules_list(self):
        """测试可选模块列表包含新增模块"""
        from app.gateway.routers.novel_migrated import _OPTIONAL_ROUTER_MODULES

        assert "app.gateway.novel_migrated.api.prompt_templates" in _OPTIONAL_ROUTER_MODULES
        assert "app.gateway.novel_migrated.api.prompt_workshop" in _OPTIONAL_ROUTER_MODULES
        assert "app.gateway.novel_migrated.api.admin" in _OPTIONAL_ROUTER_MODULES
        assert "app.gateway.novel_migrated.api.changelog" in _OPTIONAL_ROUTER_MODULES

    def test_new_api_modules_have_router(self):
        """测试新增 API 模块都有 router 属性（修复：使用字符串参数）"""
        modules_to_test = [
            "app.gateway.novel_migrated.api.prompt_templates",
            "app.gateway.novel_migrated.api.prompt_workshop",
            "app.gateway.novel_migrated.api.admin",
            "app.gateway.novel_migrated.api.changelog",
            "app.gateway.novel_migrated.api.settings",  # 新增：settings 模块
        ]

        for module_path in modules_to_test:
            try:
                module = __import__(module_path, fromlist=["router"])
                assert hasattr(module, "router"), f"{module_path} 缺少 'router' 属性"

                # 契约断言：验证 router 是 APIRouter 实例
                from fastapi import APIRouter

                assert isinstance(module.router, APIRouter), f"{module_path}.router 不是 APIRouter 实例"
                assert module.router.prefix, f"{module_path}.router 缺少 prefix"
                assert module.router.tags, f"{module_path}.router 缺少 tags"
                logger.info(f"✅ {module_path}: router 验证通过 (prefix={module.router.prefix}, tags={module.router.tags})")
            except ImportError as e:
                pytest.skip(f"{module_path} 导入失败: {e}")
            except AssertionError as e:
                pytest.fail(f"{module_path} 契约断言失败: {e}")


# ==================== 运行入口 ====================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
