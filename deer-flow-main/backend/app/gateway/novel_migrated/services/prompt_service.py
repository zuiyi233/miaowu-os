"""Unified prompt template service for novel_migrated.

支持完整小说创作流程的提示词模板管理：
- 世界构建与职业体系（拆书导入/向导生成）
- 灵感模式引导创建（INSPIRATION系列）
- 未来可扩展：章节生成、大纲续写、情节分析等

模板来源：参考项目 MuMuAINovel-main 完整移植
适用范围：主项目与小说项目统一调用
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import yaml

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

_SYSTEM_TEMPLATES_PATH = Path(__file__).resolve().parents[1] / "resources" / "prompt_templates.yaml"
_SYSTEM_TEMPLATES_LOCK = threading.Lock()
_SYSTEM_TEMPLATES_MTIME: float | None = None
_SYSTEM_TEMPLATES: dict[str, str] = {}

_CUSTOM_TEMPLATE_CACHE_TTL_SEC = 30.0
_CUSTOM_TEMPLATE_CACHE_MAX = 2048
# Inspiration templates are usually system-owned defaults.
_INSPIRATION_TEMPLATE_PREFIX = "INSPIRATION_"
_ENABLE_INSPIRATION_DB_LOOKUP = os.getenv("DEERFLOW_PROMPT_ENABLE_INSPIRATION_DB_LOOKUP", "").strip().lower() in {"1", "true", "yes", "on"}
# (user_id, template_key) -> (expires_at_monotonic, template_content or None for negative cache)
_CUSTOM_TEMPLATE_CACHE: dict[tuple[str, str], tuple[float, str | None]] = {}


class PromptService:
    """统一提示词服务 - 支持主项目与小说项目调用。

    模板分类：
    - 基础模板：世界构建、职业体系、角色生成、大纲生成、拆书导入
    - 灵感模式：书名/简介/主题/类型生成 + 智能补全（9个模板）
    """

    # ========== 基础模板（拆书导入与向导生成） ==========

    # ========== P0 章节创作模板 ==========

    # ========== P1 大纲与情节分析模板 ==========

    # ========== P2 角色与世界构建增强模板 ==========

    # ========== P3 辅助功能模板 ==========

    # ========== 灵感模式提示词（从参考项目 MuMuAINovel-main 移植） ==========
    # 来源：D:\miaowu-os\参考项目\MuMuAINovel-main\backend\app\services\prompt_service.py (第1652-1760行)
    # 用途：支持灵感模式引导式创建小说项目

    @classmethod
    def _ensure_system_templates_loaded(cls) -> None:
        """Load system templates from YAML into `PromptService` class attributes.

        - 模板外置：通过 YAML 文件扩展/更新系统模板（无需改动 Python 代码）
        - 兼容：保持 `PromptService.TEMPLATE_KEY` 的直接访问方式可用
        - 热加载：当 YAML 文件 mtime 变化时自动刷新
        """
        global _SYSTEM_TEMPLATES_MTIME, _SYSTEM_TEMPLATES

        try:
            stat = _SYSTEM_TEMPLATES_PATH.stat()
        except FileNotFoundError:
            if not _SYSTEM_TEMPLATES:
                logger.warning("System prompt templates YAML not found: %s", _SYSTEM_TEMPLATES_PATH)
            return

        mtime = stat.st_mtime
        with _SYSTEM_TEMPLATES_LOCK:
            if _SYSTEM_TEMPLATES and _SYSTEM_TEMPLATES_MTIME == mtime:
                return

            try:
                loaded = yaml.safe_load(_SYSTEM_TEMPLATES_PATH.read_text(encoding="utf-8")) or {}
            except Exception as exc:
                logger.warning("Failed to load system prompt templates YAML: %s", exc)
                return

            if not isinstance(loaded, dict):
                logger.warning(
                    "Invalid system prompt templates YAML format (expected mapping): %s",
                    _SYSTEM_TEMPLATES_PATH,
                )
                return

            templates: dict[str, str] = {}
            for raw_key, raw_value in loaded.items():
                if not isinstance(raw_key, str):
                    continue
                key = raw_key.strip()
                if not key or not key.isupper() or key.startswith("_"):
                    continue
                if not isinstance(raw_value, str):
                    continue
                templates[key] = raw_value

            _SYSTEM_TEMPLATES = templates
            _SYSTEM_TEMPLATES_MTIME = mtime

        for key, content in _SYSTEM_TEMPLATES.items():
            setattr(cls, key, content)

    @staticmethod
    def format_prompt(template: str, **kwargs) -> str:
        """格式化提示词模板。"""
        try:
            return template.format(**kwargs)
        except KeyError as exc:
            raise ValueError(f"缺少必需的参数: {exc}") from exc

    @classmethod
    async def get_template_with_fallback(
        cls,
        template_key: str,
        user_id: str | None = None,
        db=None,
    ) -> str:
        """兼容接口：当前仅返回系统模板。"""
        del user_id, db
        return await cls.get_template(template_key=template_key, user_id="", db=None)

    @classmethod
    async def get_template(
        cls,
        template_key: str,
        user_id: str,
        db,
    ) -> str:
        """获取模板（优先返回用户自定义模板，否则返回系统默认）。

        Args:
            template_key: 模板标识（如 WORLD_BUILDING, CHAPTER_GENERATION_ONE_TO_MANY）
            user_id: 用户ID（用于查询自定义模板）
            db: 数据库会话（AsyncSession）

        Returns:
            模板内容字符串

        Raises:
            ValueError: 模板不存在时抛出
        """
        cls._ensure_system_templates_loaded()
        template_key = (template_key or "").strip()
        if not template_key:
            raise ValueError("template_key is required")

        # 1. 尝试从数据库获取用户自定义模板（优先级最高）
        should_query_custom_template = bool(user_id and db)
        if template_key.startswith(_INSPIRATION_TEMPLATE_PREFIX) and not _ENABLE_INSPIRATION_DB_LOOKUP:
            should_query_custom_template = False

        if should_query_custom_template:
            now = time.monotonic()
            cache_key = (user_id, template_key)
            cached = _CUSTOM_TEMPLATE_CACHE.get(cache_key)
            if cached and cached[0] > now:
                if cached[1] is not None:
                    return cached[1]
            elif cached:
                _CUSTOM_TEMPLATE_CACHE.pop(cache_key, None)

            try:
                from sqlalchemy import select

                from app.gateway.novel_migrated.models.prompt_template import PromptTemplate

                result = await db.execute(select(PromptTemplate).where(PromptTemplate.user_id == user_id, PromptTemplate.template_key == template_key, PromptTemplate.is_active))
                custom = result.scalar_one_or_none()
                if custom and custom.template_content:
                    content = custom.template_content
                    _CUSTOM_TEMPLATE_CACHE[cache_key] = (now + _CUSTOM_TEMPLATE_CACHE_TTL_SEC, content)
                    logger.debug("使用用户自定义模板: %s (user=%s)", template_key, user_id)
                    return content
                _CUSTOM_TEMPLATE_CACHE[cache_key] = (now + _CUSTOM_TEMPLATE_CACHE_TTL_SEC, None)
            except Exception as e:
                # 数据库查询失败时降级到系统默认模板，不阻断业务
                logger.warning("查询自定义模板失败: %s, 将使用系统默认模板。错误: %s", template_key, e)
            finally:
                if len(_CUSTOM_TEMPLATE_CACHE) > _CUSTOM_TEMPLATE_CACHE_MAX:
                    # Best-effort prune (drop expired then trim oldest).
                    now2 = time.monotonic()
                    expired_keys = [k for k, (exp, _) in _CUSTOM_TEMPLATE_CACHE.items() if exp <= now2]
                    for k in expired_keys:
                        _CUSTOM_TEMPLATE_CACHE.pop(k, None)
                    overshoot = len(_CUSTOM_TEMPLATE_CACHE) - _CUSTOM_TEMPLATE_CACHE_MAX
                    if overshoot > 0:
                        for k in list(_CUSTOM_TEMPLATE_CACHE.keys())[:overshoot]:
                            _CUSTOM_TEMPLATE_CACHE.pop(k, None)

        # 2. 回退到系统内置模板（类属性）
        template_content = getattr(cls, template_key, None)
        if template_content is None:
            logger.warning("未找到提示词模板: %s", template_key)
            raise ValueError(f"未找到提示词模板: {template_key}")

        logger.debug("使用系统默认模板: %s", template_key)
        return template_content

    # ========== P2 补齐：新增方法（参考项目兼容） ==========

    @staticmethod
    def apply_style_to_prompt(base_prompt: str, style_name: str, style_description: str = "") -> str:
        """
        应用写作风格到基础提示词

        Args:
            base_prompt: 基础提示词
            style_name: 风格名称（如"古风"、"赛博朋克"）
            style_description: 风格描述

        Returns:
            应用风格后的提示词
        """
        style_instruction = f"""
<writing_style>
风格名称：{style_name}
{"风格描述：" + style_description if style_description else ""}
</writing_style>

请严格遵循上述写作风格进行创作。
"""
        return f"{base_prompt}\n\n{style_instruction}"

    @staticmethod
    def build_novel_cover_prompt(
        title: str,
        genre: str,
        theme: str,
        description: str,
        atmosphere: str = "",
    ) -> str:
        """
        构建小说封面生成提示词

        Args:
            title: 书名
            genre: 类型
            theme: 主题
            description: 简介
            atmosphere: 氛围基调

        Returns:
            封面生成提示词
        """
        return f"""请为以下小说设计一张精美的封面：

书名：《{title}》
类型：{genre}
主题：{theme}
简介：{description[:200] if description else "暂无"}
{"氛围基调：" + atmosphere if atmosphere else ""}

要求：
1. 突出小说的核心主题和氛围
2. 色彩搭配符合类型特点
3. 构图简洁大气，适合作为书籍封面
4. 避免过于复杂的元素
5. 风格统一，具有艺术感"""

    @staticmethod
    def get_chapter_regeneration_prompt(
        chapter_title: str,
        chapter_outline: str,
        previous_context: str = "",
        regeneration_reason: str = "质量优化",
    ) -> str:
        """
        获取章节重新生成提示词

        Args:
            chapter_title: 章节标题
            chapter_outline: 章节大纲
            previous_context: 前文上下文
            regeneration_reason: 重新生成原因

        Returns:
            章节重写提示词
        """
        return f"""请根据以下信息重新生成章节内容：

章节标题：{chapter_title}
章节大纲：
{chapter_outline}
{"前文上下文：\n" + previous_context[-500:] if previous_context else ""}

重新生成原因：{regeneration_reason}

要求：
1. 严格遵循章节大纲的情节安排
2. 保持与前文的连贯性
3. 提升文字质量和表现力
4. 保持人物性格和语气一致
5. 字数控制在合理范围内（3000-5000字）"""

    @staticmethod
    def get_mcp_tool_test_prompts() -> dict:
        """
        获取 MCP 工具测试提示词集合

        Returns:
            包含各类工具测试场景的提示词字典
        """
        return {
            "weather_test": "请查询北京今天的天气情况",
            "search_test": "请搜索'人工智能最新进展'相关信息",
            "calculator_test": "请计算 123 * 456 的结果",
            "translation_test": "请将'Hello, how are you?'翻译成中文",
            "code_test": "请用Python写一个快速排序算法",
        }

    @staticmethod
    def get_all_system_templates() -> list[dict]:
        """
        获取所有系统默认模板列表（用于模板管理界面）

        Returns:
            模板字典列表，每个包含 template_key, template_name, content, description, category, parameters
        """
        PromptService._ensure_system_templates_loaded()
        templates = []

        # 收集所有以大写字母开头的类属性（模板常量）
        for attr_name in dir(PromptService):
            if attr_name.isupper() and not attr_name.startswith("_"):
                attr_value = getattr(PromptService, attr_name, None)
                if isinstance(attr_value, str) and attr_value.strip():
                    templates.append(
                        {
                            "template_key": attr_name,
                            "template_name": attr_name.replace("_", " ").title(),
                            "content": attr_value,
                            "description": f"系统内置模板：{attr_name}",
                            "category": _infer_template_category(attr_name),
                            "parameters": _extract_template_parameters(attr_value),
                        }
                    )

        logger.info(f"📋 获取到 {len(templates)} 个系统默认模板")
        return templates

    @staticmethod
    def get_system_template_info(template_key: str) -> dict | None:
        """
        获取指定系统模板的信息

        Args:
            template_key: 模板标识（如 WORLD_BUILDING, CAREER_SYSTEM_GENERATION）

        Returns:
            模板信息字典，如果不存在则返回 None
        """
        PromptService._ensure_system_templates_loaded()
        template_content = getattr(PromptService, template_key, None)
        if template_content is None or not isinstance(template_content, str):
            return None

        return {
            "template_key": template_key,
            "template_name": template_key.replace("_", " ").title(),
            "content": template_content,
            "description": f"系统内置模板：{template_key}",
            "category": _infer_template_category(template_key),
            "parameters": _extract_template_parameters(template_content),
        }


def _infer_template_category(template_key: str) -> str:
    """根据模板名称推断分类"""
    key_lower = template_key.lower()
    if any(k in key_lower for k in ["world", "世界观"]):
        return "世界构建"
    elif any(k in key_lower for k in ["career", "职业"]):
        return "职业体系"
    elif any(k in key_lower for k in ["character", "角色"]):
        return "角色创建"
    elif any(k in key_lower for k in ["outline", "大纲"]):
        return "大纲生成"
    elif any(k in key_lower for k in ["inspiration", "灵感"]):
        return "灵感模式"
    elif any(k in key_lower for k in ["chapter", "章节"]):
        return "章节生成"
    else:
        return "通用"


def _extract_template_parameters(template: str) -> list[dict]:
    """从模板内容中提取参数列表（简单的 {xxx} 匹配）"""
    import re

    parameters = []
    pattern = r"\{(\w+)\}"

    for match in re.finditer(pattern, template):
        param_name = match.group(1)
        if param_name not in [p["name"] for p in parameters]:
            parameters.append(
                {
                    "name": param_name,
                    "required": True,
                    "description": f"参数: {param_name}",
                }
            )

    return parameters


# Bootstrap system templates at import time for callsites that access
# `PromptService.WORLD_BUILDING` / `PromptService.PLOT_ANALYSIS` directly.
PromptService._ensure_system_templates_loaded()
