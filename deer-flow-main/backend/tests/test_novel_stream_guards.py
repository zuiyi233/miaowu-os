from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.gateway.novel_migrated.api import novel_stream


def test_analysis_cache_cleanup_removes_expired_and_overflow_entries():
    now = datetime.now(UTC).replace(tzinfo=None)
    novel_stream._ANALYSIS_CACHE_TTL_SECONDS = 60
    novel_stream._ANALYSIS_CACHE_MAX_ENTRIES = 2

    novel_stream._ANALYSIS_TASKS.clear()
    novel_stream._ANALYSIS_RESULTS.clear()

    novel_stream._ANALYSIS_TASKS.update(
        {
            "expired": {"updated_at": (now - timedelta(minutes=10)).isoformat()},
            "recent-a": {"updated_at": (now - timedelta(seconds=30)).isoformat()},
            "recent-b": {"updated_at": (now - timedelta(seconds=20)).isoformat()},
            "recent-c": {"updated_at": (now - timedelta(seconds=10)).isoformat()},
        }
    )
    novel_stream._ANALYSIS_RESULTS.update(
        {
            "expired": {"updated_at": (now - timedelta(minutes=10)).isoformat()},
            "recent-a": {"updated_at": (now - timedelta(seconds=30)).isoformat()},
            "recent-b": {"updated_at": (now - timedelta(seconds=20)).isoformat()},
            "recent-c": {"updated_at": (now - timedelta(seconds=10)).isoformat()},
        }
    )

    novel_stream._cleanup_analysis_cache()

    assert "expired" not in novel_stream._ANALYSIS_TASKS
    assert "expired" not in novel_stream._ANALYSIS_RESULTS
    assert len(novel_stream._ANALYSIS_TASKS) <= 2
    assert len(novel_stream._ANALYSIS_RESULTS) <= 2


def test_stream_rate_limit_blocks_excess_requests():
    novel_stream._STREAM_RATE_LIMIT_PER_MINUTE = 1
    novel_stream._STREAM_REQUEST_WINDOWS.clear()

    novel_stream._enforce_stream_rate_limit(user_id="u1", action="analyze")
    with pytest.raises(HTTPException) as exc_info:
        novel_stream._enforce_stream_rate_limit(user_id="u1", action="analyze")

    assert exc_info.value.status_code == 429
