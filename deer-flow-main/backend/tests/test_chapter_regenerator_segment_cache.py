from __future__ import annotations

from app.gateway.novel_migrated.services.chapter_regenerator import ChapterRegenerator


class _DummyAIService:
    async def generate_text_stream(self, **_kwargs):
        if False:
            yield ""  # pragma: no cover


def test_segmented_content_cache_reuses_entries_for_same_long_text():
    regenerator = ChapterRegenerator(ai_service=_DummyAIService())
    long_content = "段落" * 1800

    first = regenerator._get_segmented_content(long_content)
    second = regenerator._get_segmented_content(long_content)

    assert first == long_content
    assert second == long_content
    assert len(regenerator._segmented_content_cache) == 1


def test_segmented_content_cache_has_bounded_eviction():
    regenerator = ChapterRegenerator(ai_service=_DummyAIService())
    regenerator._MAX_SEGMENT_CACHE_ENTRIES = 2

    contents = ["A" * 3200, "B" * 3200, "C" * 3200]
    for content in contents:
        assert regenerator._get_segmented_content(content) == content

    first_key = regenerator._build_content_cache_key(contents[0])
    assert len(regenerator._segmented_content_cache) == 2
    assert first_key not in regenerator._segmented_content_cache
