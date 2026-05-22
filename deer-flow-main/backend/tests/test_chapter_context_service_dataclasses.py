from __future__ import annotations

from app.gateway.novel_migrated.services.chapter_context_service import OneToManyContext, OneToOneContext


def test_one_to_many_context_total_length_uses_shared_base_fields():
    context = OneToManyContext(
        chapter_outline="大纲",
        recent_chapters_context="近章",
        continuation_point="衔接",
        chapter_characters="角色",
        chapter_careers="职业",
        relevant_memories="记忆",
        foreshadow_reminders="伏笔",
        previous_chapter_summary="上章摘要",
    )

    expected = sum(len(value) for value in ["大纲", "近章", "衔接", "角色", "职业", "记忆", "伏笔", "上章摘要"])
    assert context.get_total_context_length() == expected


def test_one_to_one_context_total_length_uses_shared_base_fields():
    context = OneToOneContext(
        chapter_outline="大纲",
        continuation_point="衔接",
        previous_chapter_summary="上章摘要",
        chapter_characters="角色",
        chapter_careers="职业",
        foreshadow_reminders="伏笔",
        relevant_memories="记忆",
    )

    expected = sum(len(value) for value in ["大纲", "衔接", "上章摘要", "角色", "职业", "伏笔", "记忆"])
    assert context.get_total_context_length() == expected
