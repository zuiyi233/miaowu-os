from __future__ import annotations

import pytest

from app.gateway.novel_migrated.models.memory import PlotAnalysis, StoryMemory


def test_story_memory_json_fields_are_normalized_to_list():
    memory = StoryMemory(
        project_id="proj-1",
        chapter_id="chapter-1",
        memory_type="hook",
        content="记忆内容",
        story_timeline=1,
    )

    memory.tags = ("悬念", "反转")
    memory.related_characters = "char-1"

    assert memory.tags == ["悬念", "反转"]
    assert memory.related_characters == ["char-1"]


def test_story_memory_is_foreshadow_rejects_invalid_value():
    memory = StoryMemory(
        project_id="proj-1",
        chapter_id="chapter-1",
        memory_type="hook",
        content="记忆内容",
        story_timeline=1,
    )

    with pytest.raises(ValueError, match="must be one of 0/1/2"):
        memory.is_foreshadow = 3


def test_plot_analysis_scores_and_ratio_fields_are_clamped():
    analysis = PlotAnalysis(project_id="proj-1", chapter_id="chapter-1")

    analysis.overall_quality_score = 12.3
    analysis.dialogue_ratio = -0.5
    analysis.conflict_level = 99

    assert analysis.overall_quality_score == 10.0
    assert analysis.dialogue_ratio == 0.0
    assert analysis.conflict_level == 10


def test_plot_analysis_json_fields_are_normalized():
    analysis = PlotAnalysis(project_id="proj-1", chapter_id="chapter-1")

    analysis.hooks = ("hook-1",)
    analysis.emotional_curve = [0.2, 0.8]

    assert analysis.hooks == ["hook-1"]
    assert analysis.emotional_curve == {"items": [0.2, 0.8]}
