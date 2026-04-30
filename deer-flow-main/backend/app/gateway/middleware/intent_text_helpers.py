"""Reusable intent text extraction helpers with cached regex compilation."""

from __future__ import annotations

import re
from functools import lru_cache

_TITLE_PATTERNS = (
    re.compile(r"《([^》]{1,60})》"),
    re.compile(r"(?:名为|叫做|叫|书名(?:是|为)?|标题(?:是|为)?)[\"“《]?([^\"”》\n，。,.!?]{1,60})[\"”》]?"),
)
_GENRE_MAP: tuple[tuple[str, str], ...] = (
    ("科幻", "科幻"),
    ("sci-fi", "科幻"),
    ("玄幻", "玄幻"),
    ("奇幻", "奇幻"),
    ("仙侠", "仙侠"),
    ("武侠", "武侠"),
    ("悬疑", "悬疑"),
    ("推理", "推理"),
    ("恐怖", "恐怖"),
    ("惊悚", "恐怖"),
    ("言情", "言情"),
    ("恋爱", "言情"),
    ("都市", "都市"),
    ("历史", "历史"),
    ("校园", "校园"),
    ("末世", "末世"),
)
_THEME_PATTERN = re.compile(r"(?:题材|主题|故事主题|核心设定)(?:是|为|：|:)?\s*([^，。,.!?\n]{1,80})")
_AUDIENCE_PATTERN = re.compile(r"(?:受众|读者|面向)(?:是|为|：|:)?\s*([^，。,.!?\n]{1,60})")
_TARGET_WORDS_PATTERN = re.compile(r"(\d{1,5})(\s*万)?\s*字")


def extract_title(user_message: str) -> str | None:
    stripped = (user_message or "").strip()
    for pattern in _TITLE_PATTERNS:
        match = pattern.search(stripped)
        if not match:
            continue
        candidate = (match.group(1) or "").strip()
        if not candidate:
            continue
        if candidate in {"小说", "一本小说", "一部小说"}:
            continue
        return candidate[:60]
    return None


def extract_genre(user_message: str) -> str | None:
    message = user_message or ""
    lowered = message.lower()
    for keyword, canonical in _GENRE_MAP:
        if keyword in lowered or keyword in message:
            return canonical
    return None


def extract_theme(user_message: str) -> str | None:
    match = _THEME_PATTERN.search(user_message or "")
    if not match:
        return None
    return match.group(1).strip()[:80]


def extract_audience(user_message: str) -> str | None:
    match = _AUDIENCE_PATTERN.search(user_message or "")
    if not match:
        return None
    return match.group(1).strip()[:60]


def extract_target_words(user_message: str) -> int | None:
    match = _TARGET_WORDS_PATTERN.search(user_message or "")
    if not match:
        return None

    number = int(match.group(1))
    if match.group(2):
        number *= 10000

    return max(1000, number)


@lru_cache(maxsize=512)
def compiled_name_pattern(keyword: str, max_len: int) -> re.Pattern[str]:
    return re.compile(
        rf"{re.escape(keyword)}\s*[：:]?\s*([\u4e00-\u9fa5A-Za-z0-9_\-]{{1,{max_len}}})"
    )


def extract_name_after_keyword(text: str, *, keywords: tuple[str, ...], max_len: int) -> str | None:
    search_text = text or ""
    for keyword in keywords:
        pattern = compiled_name_pattern(keyword, max_len)
        match = pattern.search(search_text)
        if match:
            return match.group(1).strip()
    return None


@lru_cache(maxsize=1024)
def compiled_assignment_patterns(label: str, max_len: int) -> tuple[re.Pattern[str], re.Pattern[str]]:
    return (
        re.compile(
            rf"{re.escape(label)}\s*(?:改成|改为|设为|设置为|为|是|:|：)\s*([^\n，。!?；;]{{1,{max_len}}})",
            flags=re.IGNORECASE,
        ),
        re.compile(
            rf"{re.escape(label)}\s*[:：]\s*([^\n，。!?；;]{{1,{max_len}}})",
            flags=re.IGNORECASE,
        ),
    )


def extract_assignment(text: str, *, labels: tuple[str, ...], max_len: int) -> str | None:
    search_text = text or ""
    for label in labels:
        patterns = compiled_assignment_patterns(label, max_len)
        for pattern in patterns:
            match = pattern.search(search_text)
            if not match:
                continue
            candidate = match.group(1).strip().strip('"“”')
            if candidate:
                return candidate[:max_len]
    return None


def extract_integer_assignment(text: str, *, labels: tuple[str, ...]) -> int | None:
    search_text = text or ""
    for label in labels:
        match = re.search(
            rf"{re.escape(label)}\s*(?:改成|改为|设为|设置为|为|是|:|：)?\s*(-?\d{{1,6}})",
            search_text,
            flags=re.IGNORECASE,
        )
        if match:
            return int(match.group(1))
    return None


@lru_cache(maxsize=1024)
def compiled_prefix_pattern(prefix: str) -> re.Pattern[str]:
    return re.compile(re.escape(prefix), flags=re.IGNORECASE)


def extract_long_text(text: str, *, prefixes: tuple[str, ...], max_len: int) -> str | None:
    search_text = text or ""
    for prefix in prefixes:
        match = compiled_prefix_pattern(prefix).search(search_text)
        if match is None:
            continue
        candidate = search_text[match.end() :].strip().lstrip("：:，, ")
        if candidate:
            return candidate[:max_len]
    return None


def extract_outline_mode(text: str) -> str | None:
    message = text or ""
    lowered = message.lower()
    if "一对一" in message or "one-to-one" in lowered:
        return "one-to-one"
    if "一对多" in message or "one-to-many" in lowered:
        return "one-to-many"
    return None
