# 小说工具 Internal 直连改造实施文档

## 一、背景与目标

### 1.1 现状问题

当前 16 个小说工具（`novel_creation_tools` / `novel_extended_tools` / `novel_analysis_tools`）全部通过 HTTP 调用 Gateway API：

```
LangChain @tool → httpx.AsyncClient → FastAPI Router → Service → DB/AI
```

问题：
- 额外网络延迟（本地回环 ~0.5-2ms/请求）
- 认证信息丢失（Tool 层无法传递 `user_id`，Gateway 只能回退默认用户）
- 超时风险（httpx 默认 30s 超时，AI 生成可能耗时更久）
- 错误信息模糊（HTTP 500 只能看到状态码，原始异常栈被 FastAPI 吞掉）
- 双重 AI 配置（Agent 侧用 `config.yaml`，Gateway 侧用 `settings` 表，两套配置容易不一致）

### 1.2 目标

改为 **Internal 直连优先 + HTTP fallback**：

```
LangChain @tool → 动态 import Gateway 模块 → 直接调用 Service/API 函数 → DB/AI
                 （Internal 不可用时自动 fallback 到 HTTP）
```

### 1.3 已有参考

`create_novel` 工具（`novel_tools.py`）已经实现了 Internal 直连模式，核心模式：

```python
# novel_tools.py L48-55
def _load_optional_attr(module_path: str, attr_name: str) -> Any | None:
    try:
        module = importlib.import_module(module_path)
    except Exception as exc:
        logger.debug("create_novel optional import skipped: %s (%s)", module_path, exc)
        return None
    return getattr(module, attr_name, None)

# novel_tools.py L282-316
async def _create_project_via_internal(*, modern_payload, user_id):
    init_db_schema = _load_optional_attr("app.gateway.novel_migrated.core.database", "init_db_schema")
    async_session_local = _load_optional_attr("app.gateway.novel_migrated.core.database", "AsyncSessionLocal")
    project_create_request_cls = _load_optional_attr("app.gateway.novel_migrated.api.projects", "ProjectCreateRequest")
    create_project = _load_optional_attr("app.gateway.novel_migrated.api.projects", "create_project")

    if not callable(init_db_schema) or async_session_local is None or ...:
        raise RuntimeError("internal modern project api unavailable")

    req = project_create_request_cls(...)
    await init_db_schema()
    effective_user_id = _resolve_user_id(user_id)

    async with async_session_local() as db_session:
        project = await create_project(req=req, user_id=effective_user_id, db=db_session)

    if hasattr(project, "model_dump"):
        project = project.model_dump()
    if isinstance(project, dict):
        return project
    raise RuntimeError("internal modern project api returned non-dict payload")
```

---

## 二、架构设计

### 2.1 新增文件：`novel_internal.py`

路径：`backend/packages/harness/deerflow/tools/builtins/novel_internal.py`

这是统一的 Internal 直连框架，提供所有工具共用的基础设施：

```python
"""Internal direct-call bridge for novel tools.

Provides process-internal invocation of Gateway API functions,
bypassing HTTP overhead. Falls back to HTTP when internal modules
are unavailable (e.g., deerflow package runs standalone).
"""
from __future__ import annotations

import importlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

_INTERNAL_AVAILABLE: bool | None = None


def is_internal_available() -> bool:
    """Check if internal (in-process) Gateway modules are importable."""
    global _INTERNAL_AVAILABLE
    if _INTERNAL_AVAILABLE is None:
        _INTERNAL_AVAILABLE = _check_internal_modules()
    return _INTERNAL_AVAILABLE


def _check_internal_modules() -> bool:
    try:
        mod = importlib.import_module("app.gateway.novel_migrated.core.database")
        return hasattr(mod, "AsyncSessionLocal")
    except Exception:
        return False


def load_attr(module_path: str, attr_name: str) -> Any | None:
    """Dynamically import a module and return an attribute, or None on failure."""
    try:
        module = importlib.import_module(module_path)
    except Exception as exc:
        logger.debug("novel internal import skipped: %s (%s)", module_path, exc)
        return None
    return getattr(module, attr_name, None)


async def get_internal_db():
    """Return AsyncSessionLocal class. Call `await init_db_schema()` first."""
    init_db_schema = load_attr("app.gateway.novel_migrated.core.database", "init_db_schema")
    AsyncSessionLocal = load_attr("app.gateway.novel_migrated.core.database", "AsyncSessionLocal")
    if AsyncSessionLocal is None:
        raise RuntimeError("internal db session unavailable")
    if callable(init_db_schema):
        await init_db_schema()
    return AsyncSessionLocal


async def get_internal_ai_service(
    user_id: str | None = None,
    module_id: str | None = None,
) -> Any:
    """Construct an AIService instance using the same config as the Gateway."""
    resolve_fn = load_attr(
        "app.gateway.novel_migrated.api.settings",
        "_resolve_user_ai_runtime_config",
    )
    if not callable(resolve_fn):
        raise RuntimeError("internal ai config resolver unavailable")

    runtime_config = await resolve_fn(
        user_id=resolve_user_id(user_id),
        module_id=module_id,
    )

    AIService = load_attr(
        "app.gateway.novel_migrated.services.ai_service",
        "AIService",
    )
    if AIService is None:
        raise RuntimeError("AIService class unavailable")

    # AIService 的构造方式取决于其 __init__ 签名
    # 需要确认 AIService 如何从 runtime_config 构造
    # 方案 A：如果 AIService 有 from_runtime_config 类方法
    from_config = getattr(AIService, "from_runtime_config", None)
    if callable(from_config):
        return from_config(runtime_config)

    # 方案 B：直接用 runtime_config 的字段构造
    return AIService(
        api_key=runtime_config.get("api_key", ""),
        base_url=runtime_config.get("api_base_url", ""),
        model=runtime_config.get("llm_model", ""),
        temperature=runtime_config.get("temperature", 0.7),
        max_tokens=runtime_config.get("max_tokens", 4096),
    )


def resolve_user_id(raw_user_id: str | None) -> str:
    """Resolve user_id using Gateway's user_context module."""
    resolver = load_attr(
        "app.gateway.novel_migrated.core.user_context",
        "resolve_user_id",
    )
    if callable(resolver):
        try:
            result = resolver(raw_user_id)
            if isinstance(result, str) and result.strip():
                return result.strip()
        except Exception:
            pass
    normalized = (raw_user_id or "").strip()
    return normalized or "local_single_user"


def to_dict(result: Any) -> dict[str, Any]:
    """Convert a result to dict. Handles Pydantic models, dicts, and other types."""
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump") and callable(result.model_dump):
        return result.model_dump()
    if hasattr(result, "__dict__"):
        return {k: v for k, v in result.__dict__.items() if not k.startswith("_")}
    return {"raw": result}
```

### 2.2 每个工具的改造模板

```python
@tool("tool_name", parse_docstring=True)
async def tool_name(...params...) -> dict[str, Any]:
    """docstring unchanged"""
    # 1. 幂等性检查（不变）
    dup = check_idempotency("tool_name", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="...")

    # 2. 尝试 Internal 直连
    try:
        return await _tool_name_internal(...params...)
    except Exception as exc:
        logger.warning("tool_name internal failed: %s, falling back to HTTP", exc)

    # 3. HTTP fallback（原有逻辑不变）
    base_url = get_base_url()
    ...
```

### 2.3 Internal 函数的通用模式

**A 类（只需 db）**：
```python
async def _tool_name_internal(...):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    api_fn = load_attr("app.gateway.novel_migrated.api.xxx", "endpoint_fn")
    if not callable(api_fn):
        raise RuntimeError("internal xxx unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await api_fn(...params..., user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.xxx.internal")
```

**B 类（需 db + ai_service）**：
```python
async def _tool_name_internal(...):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-xxx")
    api_fn = load_attr("app.gateway.novel_migrated.api.xxx", "endpoint_fn")
    if not callable(api_fn):
        raise RuntimeError("internal xxx unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await api_fn(...params..., user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.xxx.internal")
```

**C 类（AI 流式，用 get_stream_writer 推进度）**：
```python
async def _tool_name_internal(...):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    from langgraph.config import get_stream_writer
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-xxx")
    writer = get_stream_writer()
    # ... 直接调用 ai_service.generate_text_stream() 消费生成器
    # ... 用 writer({"type": "xxx_progress", ...}) 推送进度
    # ... 解析 AI 响应 + 保存到 DB
    return _ok(result, source="novel_migrated.xxx.internal")
```

**D 类（文件读取）**：
```python
async def _import_book_internal(file_path, project_title, ...):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    import os
    filename = os.path.basename(file_path)
    with open(file_path, "rb") as f:
        content = f.read()
    AsyncSessionLocal = await get_internal_db()
    service = load_attr("app.gateway.novel_migrated.services.book_import_service", "book_import_service")
    if service is None:
        raise RuntimeError("book_import_service unavailable")
    user_id = resolve_user_id(None)
    result = await service.create_task(
        user_id=user_id,
        filename=filename,
        file_content=content,
        project_id=None,
        create_new_project=True,
        import_mode="append",
        extract_mode="tail",
        tail_chapter_count=10,
    )
    return _ok(to_dict(result), source="novel_migrated.import_book.internal")
```

---

## 三、16 个工具的逐一改造规格

### 工具 1：`build_world`

**文件**：`novel_creation_tools.py` L14-57
**当前 HTTP**：`POST {base_url}/projects/world-build`
**API 端点**：`app.gateway.novel_migrated.api.projects.world_build`
**端点签名**：
```python
async def world_build(
    req: WorldBuildRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类（需 db + ai_service）
**Internal 函数**：
```python
async def _build_world_internal(project_id, title="", genre="", theme="", description=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-world-building")
    WorldBuildRequest = load_attr("app.gateway.novel_migrated.api.projects", "WorldBuildRequest")
    world_build_fn = load_attr("app.gateway.novel_migrated.api.projects", "world_build")
    if WorldBuildRequest is None or not callable(world_build_fn):
        raise RuntimeError("internal world_build unavailable")
    req = WorldBuildRequest(project_id=project_id, title=title, genre=genre, theme=theme, description=description)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await world_build_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.world_build.internal")
```

---

### 工具 2：`generate_characters`

**文件**：`novel_creation_tools.py` L60-96
**当前 HTTP**：`POST {base_url}/characters/generate`
**API 端点**：`app.gateway.novel_migrated.api.characters.generate_single_character`
**端点签名**：
```python
async def generate_single_character(
    req: SingleGenerateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类（需 db + ai_service）
**Internal 函数**：
```python
async def _generate_characters_internal(project_id, count=5, requirements=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-characters")
    SingleGenerateRequest = load_attr("app.gateway.novel_migrated.api.characters", "SingleGenerateRequest")
    generate_fn = load_attr("app.gateway.novel_migrated.api.characters", "generate_single_character")
    if SingleGenerateRequest is None or not callable(generate_fn):
        raise RuntimeError("internal generate_characters unavailable")
    req = SingleGenerateRequest(project_id=project_id, count=count, requirements=requirements)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await generate_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.characters.internal")
```

---

### 工具 3：`generate_outline`

**文件**：`novel_creation_tools.py` L99-151
**当前 HTTP**：两条路径
- 无 `continue_from` 时：`POST {base_url}/outlines/project/{project_id}`
- 有 `continue_from` 时：`POST {base_url}/outlines/continue`
**API 端点**：
```python
# 创建大纲
async def create_outline(
    project_id: str, req: OutlineCreateRequest,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db),
)
# 续写大纲
async def continue_outlines(
    req: OutlineContinueRequest,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类（续写需 ai_service，创建不需）
**Internal 函数**：
```python
async def _generate_outline_internal(project_id, chapter_count=10, requirements="", continue_from=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    user_id = resolve_user_id(None)

    if not continue_from:
        # 创建大纲（不需要 ai_service）
        OutlineCreateRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineCreateRequest")
        create_fn = load_attr("app.gateway.novel_migrated.api.outlines", "create_outline")
        if OutlineCreateRequest is None or not callable(create_fn):
            raise RuntimeError("internal create_outline unavailable")
        req = OutlineCreateRequest(project_id=project_id, chapter_count=chapter_count, requirements=requirements, title="", content="")
        async with AsyncSessionLocal() as db:
            result = await create_fn(project_id=project_id, req=req, user_id=user_id, db=db)
        return _ok(to_dict(result), source="novel_migrated.outline_create.internal")
    else:
        # 续写大纲（需要 ai_service）
        ai_service = await get_internal_ai_service(module_id="novel-outline")
        OutlineContinueRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineContinueRequest")
        continue_fn = load_attr("app.gateway.novel_migrated.api.outlines", "continue_outlines")
        if OutlineContinueRequest is None or not callable(continue_fn):
            raise RuntimeError("internal continue_outlines unavailable")
        req = OutlineContinueRequest(project_id=project_id, chapter_count=chapter_count, requirements=requirements, continue_from=continue_from)
        async with AsyncSessionLocal() as db:
            result = await continue_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
        return _ok(to_dict(result), source="novel_migrated.outline_continue.internal")
```

---

### 工具 4：`expand_outline`

**文件**：`novel_creation_tools.py` L154-191
**当前 HTTP**：`POST {base_url}/outlines/expand`
**API 端点**：
```python
async def expand_outline(
    req: OutlineExpandRequest,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类
**Internal 函数**：
```python
async def _expand_outline_internal(outline_id, project_id, target_chapter_count=3, strategy="single"):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-outline")
    OutlineExpandRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineExpandRequest")
    expand_fn = load_attr("app.gateway.novel_migrated.api.outlines", "expand_outline")
    if OutlineExpandRequest is None or not callable(expand_fn):
        raise RuntimeError("internal expand_outline unavailable")
    req = OutlineExpandRequest(outline_id=outline_id, project_id=project_id, target_chapter_count=target_chapter_count, strategy=strategy)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await expand_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.outline_expand.internal")
```

---

### 工具 5：`generate_chapter`

**文件**：`novel_creation_tools.py` L194-228
**当前 HTTP**：`POST {base_url}/chapters/batch-generate`
**API 端点**：
```python
async def batch_generate_chapters(
    req: BatchGenerateRequest, request: Request,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类（注意有 `request: Request` 显式参数，Internal 时传 `None`）
**Internal 函数**：
```python
async def _generate_chapter_internal(project_id, chapter_ids=None, outline_ids=None):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-management")
    BatchGenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "BatchGenerateRequest")
    batch_fn = load_attr("app.gateway.novel_migrated.api.chapters", "batch_generate_chapters")
    if BatchGenerateRequest is None or not callable(batch_fn):
        raise RuntimeError("internal batch_generate unavailable")
    req = BatchGenerateRequest(project_id=project_id, chapter_ids=chapter_ids, outline_ids=outline_ids)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await batch_fn(req=req, request=None, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.chapter_generate.internal")
```
**注意**：`batch_generate_chapters` 签名中有 `request: Request`，Internal 调用时传 `None`。需确认该函数在 `request=None` 时不会崩溃。如果函数内部使用了 `request`，需在 API 端点中增加 `request: Request = None` 默认值。

---

### 工具 6：`generate_career_system`

**文件**：`novel_creation_tools.py` L231-266
**当前 HTTP**：`GET {base_url}/api/careers/generate-system`
**API 端点**：
```python
async def generate_career_system(
    project_id: str, main_career_count: int = 3, sub_career_count: int = 6,
    user_requirements: str = "", enable_mcp: bool = False,
    http_request: Request = None,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：C 类（AI 流式，但 Internal 时直接消费 AI 生成器 + 保存结果）
**Internal 函数**：
```python
async def _generate_career_system_internal(project_id, main_career_count=3, sub_career_count=5):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    from langgraph.config import get_stream_writer
    import json

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-careers")

    # 直接调用 Service 层（绕过 SSE 包装）
    CareerService = load_attr("app.gateway.novel_migrated.services.career_service", "CareerService")
    if CareerService is None:
        raise RuntimeError("CareerService unavailable")

    # 获取项目信息构建 prompt
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        Project = load_attr("app.gateway.novel_migrated.models.project", "Project")
        if Project is None:
            raise RuntimeError("Project model unavailable")
        stmt = select(Project).where(Project.id == project_id)
        from sqlalchemy.ext.asyncio import AsyncSession
        project_result = await db.execute(stmt)
        project = project_result.scalar_one_or_none()
        if project is None:
            raise RuntimeError(f"project {project_id} not found")

        # 构建 prompt
        prompt = await CareerService.get_career_generation_prompt(
            project=project, main_career_count=main_career_count, sub_career_count=sub_career_count
        )

        # 流式调用 AI
        writer = get_stream_writer()
        ai_response = ""
        async for chunk in ai_service.generate_text_stream(prompt=prompt):
            ai_response += chunk
            if writer:
                writer({"type": "career_generation_progress", "chunk": chunk})

        # 解析 JSON
        cleaned = ai_service._clean_json_response(ai_response)
        career_data = json.loads(cleaned)

        # 保存到数据库
        result = await CareerService.parse_and_save_careers(career_data, project_id, db)
        await db.commit()

    return _ok(result, source="novel_migrated.career_system.internal")
```

---

### 工具 7：`analyze_chapter`

**文件**：`novel_analysis_tools.py` L77-101
**当前 HTTP**：`POST {base_url}/api/chapters/{chapter_id}/analyze`
**API 端点**：
```python
async def analyze_chapter(
    chapter_id: str, request: Request, payload: AnalyzeChapterRequest | None = None,
    force: bool = False,
    db: AsyncSession = Depends(get_db), user_ai_service: AIService = Depends(get_user_ai_service),
)
```
**分类**：B 类
**Internal 函数**：
```python
async def _analyze_chapter_internal(chapter_id, force=False):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-analysis")
    analyze_fn = load_attr("app.gateway.novel_migrated.api.novel_stream", "analyze_chapter")
    if not callable(analyze_fn):
        raise RuntimeError("internal analyze_chapter unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await analyze_fn(chapter_id=chapter_id, request=None, payload=None, force=force, db=db, user_ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.analyze_chapter.internal")
```
**注意**：`analyze_chapter` 签名中有 `request: Request`，Internal 调用时传 `None`。需确认函数内部不依赖 `request`（或已通过 `user_id` 参数覆盖）。

---

### 工具 8：`manage_foreshadow`

**文件**：`novel_analysis_tools.py` L104-212
**当前 HTTP**：多个端点
- `list`：`GET {base_url}/api/foreshadows/projects/{project_id}`
- `context`：`GET {base_url}/api/foreshadows/projects/{project_id}/context/{chapter_number}`
- `sync`：`POST {base_url}/api/foreshadows/projects/{project_id}/sync-from-analysis`
- `create`：`POST {base_url}/api/foreshadows`
- `update`：`PUT {base_url}/api/foreshadows/{foreshadow_id}`
- `plant/resolve/abandon`：`POST {base_url}/api/foreshadows/{foreshadow_id}/{action}`

**API 端点**：
```python
async def get_project_foreshadows(
    project_id: str, request: Request, ..., db: AsyncSession = Depends(get_db))
async def create_foreshadow(data: ForeshadowCreate, request: Request, db: AsyncSession = Depends(get_db))
async def update_foreshadow(foreshadow_id: str, data: ForeshadowUpdate, request: Request, db: AsyncSession = Depends(get_db))
```
**分类**：A 类（CRUD，只需 db）
**Internal 函数**：按 action 分支调用不同端点，每个端点传 `request=None`，手动传 `user_id`。
**注意**：这些端点在函数体内通过 `get_user_id(request)` 获取 `user_id`。Internal 调用时 `request=None`，需要确认 `get_user_id(None)` 是否能正常回退到默认用户。如果不能，需要在 API 端点中增加可选的 `user_id` 参数。

---

### 工具 9：`search_memories`

**文件**：`novel_analysis_tools.py` L215-248
**当前 HTTP**：`POST {base_url}/api/memories/projects/{project_id}/search`
**API 端点**：
```python
async def search_memories(
    project_id: str, request: Request, query: str,
    memory_types: list[str] | None = None, limit: int = 10, ...,
    db: AsyncSession = Depends(get_db))
```
**分类**：A 类（语义搜索走 memory_service，不需要 ai_service）
**Internal 函数**：
```python
async def _search_memories_internal(project_id, query, memory_type="", limit=10):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    search_fn = load_attr("app.gateway.novel_migrated.api.memories", "search_memories")
    if not callable(search_fn):
        raise RuntimeError("internal search_memories unavailable")
    async with AsyncSessionLocal() as db:
        result = await search_fn(
            project_id=project_id, request=None, query=query,
            memory_types=[memory_type] if memory_type else None, limit=limit, db=db,
        )
    return _ok(to_dict(result), source="novel_migrated.memory_search.internal")
```

---

### 工具 10：`check_consistency`

**文件**：`novel_analysis_tools.py` L251-272
**当前 HTTP**：`GET {base_url}/polish/projects/{project_id}/consistency-report`
**API 端点**：
```python
async def get_project_consistency_report(
    project_id: str, user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db))
```
**分类**：A 类
**Internal 函数**：
```python
async def _check_consistency_internal(project_id):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    report_fn = load_attr("app.gateway.novel_migrated.api.polish", "get_project_consistency_report")
    if not callable(report_fn):
        raise RuntimeError("internal consistency_report unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await report_fn(project_id=project_id, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.consistency_check.internal")
```

---

### 工具 11：`polish_text`

**文件**：`novel_analysis_tools.py` L275-305
**当前 HTTP**：`POST {base_url}/polish`
**API 端点**：
```python
async def polish_text(
    req: PolishRequest, user_id: str = Depends(get_user_id),
    ai_service: AIService = Depends(get_user_ai_service))
```
**分类**：B 类（需 ai_service，不需要 db）
**Internal 函数**：
```python
async def _polish_text_internal(text, style="literary", project_id=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    ai_service = await get_internal_ai_service(module_id="novel-chapter-ai-edit")
    PolishRequest = load_attr("app.gateway.novel_migrated.api.polish", "PolishRequest")
    polish_fn = load_attr("app.gateway.novel_migrated.api.polish", "polish_text")
    if PolishRequest is None or not callable(polish_fn):
        raise RuntimeError("internal polish_text unavailable")
    req = PolishRequest(text=text, style=style, project_id=project_id or None)
    user_id = resolve_user_id(None)
    result = await polish_fn(req=req, user_id=user_id, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.polish.internal")
```

---

### 工具 12：`regenerate_chapter`

**文件**：`novel_extended_tools.py` L26-81
**当前 HTTP**：`POST {base_url}/chapters/regenerate`
**API 端点**：
```python
async def regenerate_chapter(
    req: RegenerateRequest, request: Request,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db))
```
**分类**：A 类（仅创建任务记录，AI 由后台 worker 处理，不需要 ai_service）
**Internal 函数**：
```python
async def _regenerate_chapter_internal(project_id, chapter_id, modification_instructions="", custom_instructions="", target_word_count=3000, focus_areas=None, preserve_elements=None):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    RegenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "RegenerateRequest")
    regen_fn = load_attr("app.gateway.novel_migrated.api.chapters", "regenerate_chapter")
    if RegenerateRequest is None or not callable(regen_fn):
        raise RuntimeError("internal regenerate_chapter unavailable")
    req = RegenerateRequest(
        project_id=project_id, chapter_id=chapter_id,
        modification_instructions=modification_instructions,
        custom_instructions=custom_instructions, target_word_count=target_word_count,
        focus_areas=focus_areas, preserve_elements=preserve_elements,
    )
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await regen_fn(req=req, request=None, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.regenerate.internal")
```

---

### 工具 13：`partial_regenerate`

**文件**：`novel_extended_tools.py` L84-134
**当前 HTTP**：`POST {base_url}/chapters/partial-regenerate`
**API 端点**：
```python
async def partial_regenerate(
    req: PartialRegenerateRequest, request: Request,
    user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service))
```
**分类**：B 类
**Internal 函数**：
```python
async def _partial_regenerate_internal(project_id, chapter_id, selected_text, context_before="", context_after="", user_instructions=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-ai-edit")
    PartialRegenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "PartialRegenerateRequest")
    partial_fn = load_attr("app.gateway.novel_migrated.api.chapters", "partial_regenerate")
    if PartialRegenerateRequest is None or not callable(partial_fn):
        raise RuntimeError("internal partial_regenerate unavailable")
    req = PartialRegenerateRequest(
        project_id=project_id, chapter_id=chapter_id, selected_text=selected_text,
        context_before=context_before, context_after=context_after, user_instructions=user_instructions,
    )
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await partial_fn(req=req, request=None, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.partial_regenerate.internal")
```

---

### 工具 14：`finalize_project`

**文件**：`novel_extended_tools.py` L137-173
**当前 HTTP**：两步
1. `GET {base_url}/polish/projects/{project_id}/consistency-report`
2. `POST {base_url}/polish/projects/{project_id}/finalize`
**API 端点**：
```python
async def get_project_consistency_report(project_id: str, user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db))
async def finalize_project(project_id: str, req: FinalizeGateRequest | None = None, user_id: str = Depends(get_user_id), db: AsyncSession = Depends(get_db))
```
**分类**：A 类
**Internal 函数**：
```python
async def _finalize_project_internal(project_id):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    user_id = resolve_user_id(None)

    # Step 1: gate check
    report_fn = load_attr("app.gateway.novel_migrated.api.polish", "get_project_consistency_report")
    if callable(report_fn):
        async with AsyncSessionLocal() as db:
            gate_data = await report_fn(project_id=project_id, user_id=user_id, db=db)
        gate_dict = to_dict(gate_data)
        if gate_dict.get("success") is False:
            return _ok(gate_dict, source="novel_migrated.finalize_gate.internal")

    # Step 2: finalize
    finalize_fn = load_attr("app.gateway.novel_migrated.api.polish", "finalize_project")
    if not callable(finalize_fn):
        raise RuntimeError("internal finalize_project unavailable")
    async with AsyncSessionLocal() as db:
        result = await finalize_fn(project_id=project_id, req=None, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.finalize.internal")
```

---

### 工具 15：`import_book`

**文件**：`novel_extended_tools.py` L176-207
**当前 HTTP**：`POST {base_url}/book-import/tasks`（multipart 上传）
**API 端点**：
```python
async def create_book_import_task(
    request: Request, file: UploadFile = File(...), project_id: str | None = Form(...), ...)
```
**分类**：D 类（直接读文件，不需要构造 UploadFile）
**Internal 函数**：
```python
async def _import_book_internal(file_path, project_title=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, resolve_user_id, load_attr, to_dict,
    )
    import os
    filename = os.path.basename(file_path)
    with open(file_path, "rb") as f:
        content = f.read()
    service = load_attr("app.gateway.novel_migrated.services.book_import_service", "book_import_service")
    if service is None:
        raise RuntimeError("book_import_service unavailable")
    user_id = resolve_user_id(None)
    result = await service.create_task(
        user_id=user_id,
        filename=filename,
        file_content=content,
        project_id=None,
        create_new_project=True,
        import_mode="append",
        extract_mode="tail",
        tail_chapter_count=10,
    )
    return _ok(to_dict(result), source="novel_migrated.import_book.internal")
```

---

### 工具 16：`update_character_states`

**文件**：`novel_extended_tools.py` L210-251
**当前 HTTP**：`POST {base_url}/api/memories/projects/{project_id}/analyze-chapter/{chapter_id}`
**API 端点**：
```python
async def analyze_chapter(
    project_id: str, chapter_id: str, request: Request, db: AsyncSession = Depends(get_db))
```
**注意**：这个端点在 `memories.py` 中，和工具 7 的 `analyze_chapter`（在 `novel_stream.py` 中）是不同的端点。这个端点的 `ai_service` 在函数体内通过 `get_user_ai_service_with_overrides(request, db, module_id=...)` 手动获取。
**分类**：B 类（函数体内手动获取 ai_service）
**Internal 函数**：
```python
async def _update_character_states_internal(chapter_id, project_id=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db, get_internal_ai_service, resolve_user_id, load_attr, to_dict,
    )
    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-characters")
    analyze_fn = load_attr("app.gateway.novel_migrated.api.memories", "analyze_chapter")
    if not callable(analyze_fn):
        raise RuntimeError("internal memories.analyze_chapter unavailable")
    async with AsyncSessionLocal() as db:
        # memories.py 的 analyze_chapter 内部手动获取 ai_service
        # Internal 直连时需要确认该函数是否接受外部传入的 ai_service
        # 如果不接受，需要对该端点做微调
        result = await analyze_fn(project_id=project_id, chapter_id=chapter_id, request=None, db=db)
    return _ok(to_dict(result), source="novel_migrated.character_states.internal")
```
**注意**：`memories.py` 的 `analyze_chapter` 在函数体内通过 `get_user_ai_service_with_overrides(request, db, ...)` 获取 `ai_service`。Internal 调用时 `request=None`，需要确认 `get_user_ai_service_with_overrides(None, db, ...)` 是否能正常工作。如果不能，需要对该端点增加可选的 `ai_service` 参数。

---

## 四、Gateway API 端点微调清单

以下端点需要小幅改造以支持 Internal 直连调用：

| 文件 | 端点函数 | 改造内容 |
|------|---------|---------|
| `api/chapters.py` | `batch_generate_chapters` | `request: Request` → `request: Request = None` |
| `api/careers.py` | `generate_career_system` | 增加 `user_id: str = None` 可选参数，当 `http_request is None and user_id` 时直接使用传入的 `user_id` |
| `api/memories.py` | `analyze_chapter` | 增加 `user_id: str = None` 可选参数，当 `request is None and user_id` 时直接使用 |
| `api/novel_stream.py` | `analyze_chapter` | 增加 `user_id: str = None` 可选参数 |
| `api/foreshadows.py` | 所有端点 | 确认 `get_user_id(None)` 能正常回退到默认用户 |

---

## 五、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `tools/builtins/novel_internal.py` | **新增** | 统一 Internal 直连框架 |
| `tools/builtins/novel_creation_tools.py` | 修改 | 6 个工具增加 Internal 直连 + HTTP fallback |
| `tools/builtins/novel_extended_tools.py` | 修改 | 5 个工具增加 Internal 直连 + HTTP fallback |
| `tools/builtins/novel_analysis_tools.py` | 修改 | 5 个工具增加 Internal 直连 + HTTP fallback |
| `tools/builtins/novel_tools.py` | 修改 | `create_novel` 复用 `novel_internal.py` 的公共函数，消除重复的 `_load_optional_attr` 和 `_resolve_user_id` |
| `novel_migrated/api/chapters.py` | 微调 | `request: Request` → `request: Request = None` |
| `novel_migrated/api/careers.py` | 微调 | 增加 `user_id` 可选参数 |
| `novel_migrated/api/memories.py` | 微调 | 增加 `user_id` 可选参数 |
| `novel_migrated/api/novel_stream.py` | 微调 | 增加 `user_id` 可选参数 |
| `novel_migrated/services/ai_service.py` | 微调 | 确认 `AIService` 可从 `runtime_config` 构造（增加 `from_runtime_config` 类方法） |

---

## 六、实施顺序

1. **Phase 1**：新建 `novel_internal.py` + 改造 A 类工具（5 个：manage_foreshadow, search_memories, check_consistency, finalize_project, regenerate_chapter）
2. **Phase 2**：改造 B 类工具（9 个：build_world, generate_characters, generate_outline, expand_outline, generate_chapter, partial_regenerate, analyze_chapter, polish_text, update_character_states）
3. **Phase 3**：改造 C 类（1 个：generate_career_system）+ D 类（1 个：import_book）
4. **Phase 4**：重构 `create_novel` 复用 `novel_internal.py` + Gateway API 端点微调 + 端到端测试

---

## 七、验证标准

每个工具改造后需验证：

1. **Internal 可用时**：调用走 Internal 路径，返回结果与 HTTP 一致
2. **Internal 不可用时**（如 Gateway 未启动）：自动 fallback 到 HTTP，行为与改造前完全一致
3. **AI 配置一致性**：Internal 调用使用的 AI 模型/密钥与前端 AI 供应商设置页一致
4. **user_id 传递**：Internal 调用能正确传递 `user_id`，不再回退到默认用户
5. **流式进度**：C 类工具 Internal 调用时，前端仍能收到进度事件（通过 `get_stream_writer()`）

---

## 八、关键注意事项

1. **`request: Request = None` 改造**：部分 API 端点签名中有 `request: Request` 显式参数（非 Depends 注入），Internal 调用时传 `None`。需确认函数内部不依赖 `request` 对象，或已通过其他参数覆盖。

2. **`AIService` 构造**：`get_internal_ai_service()` 需要从 `_resolve_user_ai_runtime_config` 返回的 `runtime_config` 字典构造 `AIService` 实例。需确认 `AIService.__init__` 的参数签名与 `runtime_config` 字典的 key 对应关系。

3. **SSE 端点**：`generate_career_system` 的 API 端点返回 `StreamingResponse`，Internal 直连时**不走 API 端点**，而是直接调用 `CareerService` 的方法。这避免了 SSE 适配问题。

4. **数据库会话生命周期**：Internal 调用使用 `async with AsyncSessionLocal() as db:` 管理会话，确保请求结束后会话正确关闭。

5. **幂等性检查**：Internal 和 HTTP 共用同一个 `check_idempotency`，无需重复。

6. **`novel_tools.py` 的 `_load_optional_attr` 和 `_resolve_user_id`**：改造后应删除这两个函数，统一使用 `novel_internal.py` 中的 `load_attr` 和 `resolve_user_id`。
