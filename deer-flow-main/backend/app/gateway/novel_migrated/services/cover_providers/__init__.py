"""Cover provider implementations for novel_migrated."""

from app.gateway.novel_migrated.services.cover_providers.base_cover_provider import (
    BaseCoverProvider,
    CoverGenerationResult,
)
from app.gateway.novel_migrated.services.cover_providers.gemini_cover_provider import (
    GeminiCoverProvider,
)
from app.gateway.novel_migrated.services.cover_providers.grok_cover_provider import (
    GrokCoverProvider,
)

__all__ = [
    "BaseCoverProvider",
    "CoverGenerationResult",
    "GeminiCoverProvider",
    "GrokCoverProvider",
]
