"""Writing-skill routing tools for the Miaowu-OS novel agent.

Three tools that implement the two-stage routing pattern:
1. list_writing_skill_candidates  — hybrid keyword + vector candidate selection
2. invoke_writing_skill            — on-demand full-text retrieval with per-thread rate limit
3. refresh_writing_skill_index     — force-reload the pre-built index
"""

from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from deerflow.skills.writing_skill_index import WritingSkillIndex, load_writing_skill_user_config

logger = logging.getLogger(__name__)

_MAX_CANDIDATES = 12


def _get_index() -> WritingSkillIndex:
    return WritingSkillIndex.get_instance()


def _resolve_thread_id(config: dict | None = None) -> str:
    if config and isinstance(config, dict):
        tid = config.get("thread_id") or config.get("run_id")
        if tid:
            return str(tid)
    return "_default"


def _resolve_user_id(config: dict | None = None) -> str | None:
    if not config or not isinstance(config, dict):
        return None
    for key in ("user_id", "userId"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    configurable = config.get("configurable")
    if isinstance(configurable, dict):
        for key in ("user_id", "userId"):
            value = configurable.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    context = config.get("context")
    if isinstance(context, dict):
        for key in ("user_id", "userId"):
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


@tool("list_writing_skill_candidates", parse_docstring=True)
async def list_writing_skill_candidates(
    intent: str,
    context: str | None = None,
    category: str | None = None,
    max_candidates: int = 8,
    config: dict | None = None,
) -> dict[str, Any]:
    """根据当前意图列出候选写作技能摘要，不返回全文。

    当用户请求涉及小说创作指导、写作技巧、结构优化、人设设计等场景时调用。
    普通闲聊或非写作相关请求不需要调用此工具。

    Args:
        intent: 当前用户意图或任务描述，如"设计反派""开篇钩子""章节节奏优化"
        context: 可选的对话/小说上下文，帮助更精准匹配
        category: 可选的分类过滤。可选值：开篇/角色/情节/节奏/爽点/伏笔/文风/世界观/长篇结构/情感/对话/修稿/职业线/综合
        max_candidates: 最大候选数，默认8，上限12

    Returns:
        包含 candidates 列表的字典，每个候选含 slug/name/description/category/routing_hints
    """
    idx = _get_index()
    user_id = _resolve_user_id(config)

    if max_candidates < 1:
        max_candidates = 8
    if max_candidates > _MAX_CANDIDATES:
        max_candidates = _MAX_CANDIDATES

    user_config = await load_writing_skill_user_config(user_id)
    if user_config.embedding:
        idx.warm_user_vector_index(user_config)

    candidates = idx.search_candidates(
        intent=intent,
        context=context,
        category=category,
        max_candidates=max_candidates,
        user_config=user_config,
    )

    items = []
    for c in candidates:
        items.append({
            "slug": c.slug,
            "name": c.name,
            "description": c.description,
            "category": c.category,
            "routing_hints": c.routing_hints,
        })

    return {
        "success": True,
        "total_candidates": len(items),
        "candidates": items,
    }


@tool("invoke_writing_skill", parse_docstring=True)
async def invoke_writing_skill(
    skill_slug: str,
    config: dict | None = None,
) -> dict[str, Any]:
    """按 slug 获取单个写作技能的完整方法论内容。

    先通过 list_writing_skill_candidates 获取候选列表，再选择最相关的技能调用此工具。
    一轮对话内全文展开不超过3个技能，避免 prompt 噪音。

    Args:
        skill_slug: 技能标识符，如 "character-biography"、"chapter-pacing"

    Returns:
        包含 slug/name/content 的字典，content 为完整方法论 Markdown
    """
    idx = _get_index()
    thread_id = _resolve_thread_id(config)
    allowed, remaining = idx.check_invoke_limit(thread_id)
    if not allowed:
        return {
            "success": False,
            "error": "Writing skill invoke limit reached for this thread. Maximum 3 full-skill expansions per 10-minute window.",
            "thread_id": thread_id,
            "remaining_invokes": remaining,
        }

    entry = idx.get_entry(skill_slug)
    if entry is None:
        return {
            "success": False,
            "error": f"Skill '{skill_slug}' not found in writing skill index",
            "available_slugs": idx.list_slugs(20),
        }

    content = idx.read_skill_content(skill_slug)
    if content is None:
        return {
            "success": False,
            "error": f"Skill '{skill_slug}' content file not found or unreadable",
        }

    return {
        "success": True,
        "slug": entry.slug,
        "name": entry.name,
        "category": entry.category,
        "content": content,
        "thread_id": thread_id,
        "remaining_invokes": remaining,
    }


@tool("refresh_writing_skill_index", parse_docstring=True)
async def refresh_writing_skill_index() -> dict[str, Any]:
    """重建写作技能索引缓存。当技能源文件更新后调用。

    Returns:
        包含 total_skills/categories/content_hash/vector_available 的统计信息
    """
    idx = _get_index()
    stats = idx.reload()
    return {
        "success": True,
        **stats,
    }
