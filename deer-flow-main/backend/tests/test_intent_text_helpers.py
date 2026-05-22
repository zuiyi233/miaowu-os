from __future__ import annotations

from app.gateway.middleware.intent_text_helpers import (
    compiled_assignment_patterns,
    compiled_name_pattern,
    extract_assignment,
    extract_audience,
    extract_genre,
    extract_long_text,
    extract_target_words,
    extract_title,
)


def test_intent_text_helpers_extract_structured_fields_and_cache_regex() -> None:
    text = "请帮我创建一部名为《星际迷航》的科幻小说，目标20万字。"

    assert extract_title(text) == "星际迷航"
    assert extract_genre(text) == "科幻"
    assert extract_target_words(text) == 200000
    assert extract_audience("面向青少年读者") == "青少年读者"

    assignment_text = "标题改成 星海回声\n内容为：这是正文内容"
    assert extract_assignment(assignment_text, labels=("标题", "title"), max_len=120) == "星海回声"
    assert extract_long_text(assignment_text, prefixes=("内容为",), max_len=6) == "这是正文内容"[:6]

    first_assignment_patterns = compiled_assignment_patterns("标题", 120)
    second_assignment_patterns = compiled_assignment_patterns("标题", 120)
    assert first_assignment_patterns is second_assignment_patterns

    first_name_pattern = compiled_name_pattern("角色", 80)
    second_name_pattern = compiled_name_pattern("角色", 80)
    assert first_name_pattern is second_name_pattern
