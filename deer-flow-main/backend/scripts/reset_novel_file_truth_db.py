"""重置 novel_migrated 开发数据库为“文件真值最小模式”。

用途：
1) 删除旧正文/设定表（章节、角色、大纲、关系、职业、记忆等）；
2) 仅保留 document index + 运行态控制相关表；
3) 以 minimal_file_truth 模式补齐必要表结构。

执行：
    uv run python backend/scripts/reset_novel_file_truth_db.py
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

SCHEMA_MODE_ENV = "NOVEL_FILE_TRUTH_SCHEMA_MODE"
SCHEMA_MODE_MINIMAL = "minimal_file_truth"

# 仅保留“索引缓存 + 运行态控制”所需表
KEEP_TABLES = {
    "document_indexes",
    "projects",
    "analysis_tasks",
    "batch_generation_tasks",
    "regeneration_tasks",
    "intent_session_states",
    "intent_idempotency_keys",
    "ai_metrics",
    "novel_dual_write_log",
    "mcp_plugins",
    "novel_agent_configs",
    "prompt_templates",
    "prompt_workshop_items",
    "prompt_submissions",
    "prompt_workshop_likes",
    "settings",
    "users",
    "user_passwords",
    "writing_styles",
    "project_default_styles",
    "generation_history",
}


def _drop_legacy_tables(db_path: Path) -> list[str]:
    dropped: list[str] = []
    if not db_path.exists():
        return dropped

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=OFF")
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        for (name,) in rows:
            if name in KEEP_TABLES:
                continue
            conn.execute(f'DROP TABLE IF EXISTS "{name}"')
            dropped.append(name)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
    return dropped


async def _rebuild_minimal_schema() -> None:
    from app.gateway.novel_migrated.core.database import init_db_schema

    os.environ[SCHEMA_MODE_ENV] = SCHEMA_MODE_MINIMAL
    await init_db_schema()


def main() -> None:
    from app.gateway.novel_migrated.core.database import _DB_PATH

    print(f"[reset] target db: {_DB_PATH}")
    dropped = _drop_legacy_tables(_DB_PATH)
    print(f"[reset] dropped tables: {len(dropped)}")
    if dropped:
        print("         " + ", ".join(sorted(dropped)))

    asyncio.run(_rebuild_minimal_schema())
    print(f"[reset] schema mode set: {SCHEMA_MODE_MINIMAL}")
    print("[reset] minimal file-truth schema initialized.")


if __name__ == "__main__":
    main()
