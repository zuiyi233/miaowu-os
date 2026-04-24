from .clarification_tool import ask_clarification_tool
from .media_draft_tools import generate_image_draft, generate_tts_draft
from .novel_analysis_tools import (
    analyze_chapter,
    check_consistency,
    manage_foreshadow,
    polish_text,
    search_memories,
)
from .novel_creation_tools import (
    build_world,
    expand_outline,
    generate_career_system,
    generate_chapter,
    generate_characters,
    generate_outline,
)
from .novel_extended_tools import (
    finalize_project,
    import_book,
    partial_regenerate,
    regenerate_chapter,
    update_character_states,
)
from .novel_tools import create_novel
from .present_file_tool import present_file_tool
from .setup_agent_tool import setup_agent
from .task_tool import task_tool
from .view_image_tool import view_image_tool

CORE_BUILTIN_TOOLS = (
    present_file_tool,
    ask_clarification_tool,
    generate_image_draft,
    generate_tts_draft,
)

NOVEL_BUILTIN_TOOLS = (
    create_novel,
    build_world,
    generate_characters,
    generate_outline,
    expand_outline,
    generate_chapter,
    generate_career_system,
    analyze_chapter,
    manage_foreshadow,
    search_memories,
    check_consistency,
    polish_text,
    regenerate_chapter,
    partial_regenerate,
    finalize_project,
    import_book,
    update_character_states,
)

__all__ = [
    "setup_agent",
    "present_file_tool",
    "ask_clarification_tool",
    "create_novel",
    "generate_image_draft",
    "generate_tts_draft",
    "view_image_tool",
    "task_tool",
    "build_world",
    "generate_characters",
    "generate_outline",
    "expand_outline",
    "generate_chapter",
    "generate_career_system",
    "analyze_chapter",
    "manage_foreshadow",
    "search_memories",
    "check_consistency",
    "polish_text",
    "regenerate_chapter",
    "partial_regenerate",
    "finalize_project",
    "import_book",
    "update_character_states",
    "CORE_BUILTIN_TOOLS",
    "NOVEL_BUILTIN_TOOLS",
]
