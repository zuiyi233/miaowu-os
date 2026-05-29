# 重排序模型（Reranker）全模块接入方案

> 版本：v1.2 | 日期：2026-05-30 | 状态：待评审
>
> **v1.2 修订**：
> - 修正 `_UserModelConfig` 不可删除（被 VectorSearchBackend 共用）
> - 修正 `RerankerService` 文件位置（不应放在 novel_migrated 下）
> - 修正同步/异步兼容问题（WritingSkillIndex.search_candidates 是同步方法）
> - 补充前端 UI 变更说明
> - 修正 AI Creator TypeScript 的配置模型差异
> - 明确 P0-2 方案选择

---

## 一、背景与动机

项目已在写作技能索引（`WritingSkillIndex`）中实现了 `_RerankBackend`，通过云端 `/rerank` 端点对候选技能做最终语义重排。实践证明 Reranker 能显著提升检索精度——尤其在字面相似但语义不同的 case 上。

当前项目中还有多个模块依赖向量/语义检索，但**均未接入 Reranker**：

| 模块 | 检索方式 | Reranker | 问题 |
|------|----------|----------|------|
| 小说记忆服务 `MemoryService` | ChromaDB + cosine similarity | ❌ | 角色关系/伏笔等复杂语义易误召回 |
| RAG 上下文组装 `NovelContextAssembler` | 依赖 MemoryService | ❌ | 低相关度记忆挤占 token 预算 |
| 意图识别引擎 `IntentDecisionEngine` | 本地 sentence-transformers | ❌ | 边界 case 意图判断不准 |
| DeerFlow 核心记忆 | 纯文件 I/O + confidence 排序 | ❌ | facts 数量多时筛选不够精准 |
| AI Creator (TypeScript) | MongoDB Atlas Vector Search | ❌ | 创作素材检索质量可提升 |

**核心问题**：各模块独立实现向量检索，但缺少"精排"环节，导致召回率高但精度不足。

---

## 二、总体架构

### 2.1 抽取通用 RerankerService

将 `_RerankBackend` 从 `writing_skill_index.py` 中抽取为**通用服务**，所有模块共享：

```
┌──────────────────────────────────────────────────────────────┐
│                   RerankerService (通用)                       │
│                                                              │
│  位置：app/gateway/services/reranker_service.py               │
│                                                              │
│  配置体系（以用户级为主，环境变量仅作部署级兜底）：                │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  主配置源：用户 Settings 表（per-user）                │     │
│  │  ┌─────────────────────────────────────────────┐    │     │
│  │  │ settings.api_key          → Reranker API Key │    │     │
│  │  │ settings.api_base_url     → Reranker 基址     │    │     │
│  │  │ preferences.rerank_model  → Reranker 模型名   │    │     │
│  │  │ preferences.reranker_model → (别名)          │    │     │
│  │  │ preferences.rerank_enabled → 用户级开关       │    │     │
│  │  └─────────────────────────────────────────────┘    │     │
│  └─────────────────────────────────────────────────────┘     │
│                          │ 用户无配置时降级                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  兜底配置源：环境变量（部署级，所有用户共享）             │     │
│  │  ┌─────────────────────────────────────────────┐    │     │
│  │  │ RERANK_API_KEY / RERANK_BASE_URL / RERANK_MODEL│   │     │
│  │  │ WRITING_SKILL_RERANK_* (向后兼容)             │    │     │
│  │  └─────────────────────────────────────────────┘    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  接口：                                                       │
│  - async_rerank(query, documents, user_id, top_n)           │
│  - rerank(query, documents, user_id, top_n)  # 同步包装      │
│                                                              │
│  降级策略：                                                   │
│  用户配置 → 环境变量 → 静默跳过（保持原排序）                    │
│                                                              │
│  特性：                                                       │
│  - 复用 httpx.AsyncClient（长连接）                            │
│  - 用户配置缓存（TTL 120s，与 MemoryService 一致）              │
│  - 配额感知（尊重用户向量配额限制）                              │
│  - 超时控制（默认 10s，可配置）                                  │
└──────────┬──────────────┬──────────────┬──────────────────────┘
           │              │              │
   ┌───────┴─────┐ ┌──────┴──────┐ ┌────┴──────────┐
   ▼             ▼ ▼             ▼ ▼               ▼
写作技能      小说记忆       RAG管线        意图识别
(迁移到      (P0新增)      (P0新增)      (P1可选)
通用服务)
```

### 2.2 设计原则

1. **用户级配置优先**：Reranker 配置以用户 Settings 表为主源，与现有 Embedding 配置模式完全一致；环境变量仅作部署级兜底
2. **零侵入降级**：Reranker 不可用时静默降级为原排序，不影响任何核心功能
3. **异步优先**：所有新增 Reranker 调用均使用 `async`，与现有 async 框架一致
4. **成本可控**：Reranker 调用有 API 成本，通过用户级开关和配额控制
5. **向后兼容**：保留 `WRITING_SKILL_RERANK_*` 环境变量作为 fallback，不破坏现有部署
6. **配置复用**：Reranker 的 `api_key` / `api_base_url` 与 Embedding 共用同一份用户配置（Settings 表），仅 `model` 字段独立

---

## 三、通用 RerankerService 实现

### 3.1 文件位置

```
backend/app/gateway/services/reranker_service.py
```

> **为什么不在 `novel_migrated/services/` 下？**
> RerankerService 是通用服务，不仅服务于小说记忆，还服务于意图识别（`middleware/`）、
> 核心记忆（`harness/`）等。放在 `app/gateway/services/` 下更合理，与 `app/gateway/services.py`
> 同级，表明这是 Gateway 层的通用基础设施。

### 3.2 核心接口

```python
class RerankerService:
    """通用重排序服务 - 支持云端 Reranker API 与静默降级。"""

    _instance: RerankerService | None = None

    @classmethod
    def get_instance(cls) -> RerankerService:
        """单例模式，与 MemoryService 保持一致。"""

    async def async_rerank(
        self,
        query: str,
        documents: list[str],
        *,
        user_id: str | None = None,
        top_n: int | None = None,
        model: str | None = None,
    ) -> list[RerankResult]:
        """
        异步重排序。

        Args:
            query: 查询文本
            documents: 待排序的文档列表
            user_id: 用户ID（用于读取 per-user 配置）
            top_n: 返回前 N 个结果，None 表示返回全部
            model: 覆盖使用的模型名

        Returns:
            按相关性降序排列的 RerankResult 列表
            如果 Reranker 不可用，返回空列表（调用方保持原排序）
        """

    def rerank(
        self,
        query: str,
        documents: list[str],
        *,
        user_id: str | None = None,
        top_n: int | None = None,
    ) -> list[RerankResult]:
        """同步版本（内部调用 async_rerank）。"""


@dataclass(frozen=True)
class RerankResult:
    index: int          # 原始文档列表中的索引
    relevance_score: float  # 相关性分数 0.0-1.0
```

### 3.3 配置解析——以用户级为主

**核心原则**：与现有 `MemoryService._load_cloud_embedding_config()` 和 `load_writing_skill_user_config()` 完全一致的配置模式——**用户 Settings 表为主，环境变量仅作部署级兜底**。

#### 3.3.1 配置解析流程

```python
async def _resolve_config(self, user_id: str | None) -> _RerankConfig | None:
    """
    配置解析流程（与 MemoryService._load_cloud_embedding_config 一致）：

    Step 1: 读取用户 Settings 表（per-user）
      - settings.api_key (加密) → Reranker API Key
      - settings.api_base_url   → Reranker 基址
      - preferences.rerank_model / reranker_model / rerankModel → Reranker 模型名
      - preferences.rerank_enabled → 用户级开关（"false"/"0" 禁用）

    Step 2: 如果用户有 api_key 但无 rerank_model → 使用环境变量 RERANK_MODEL 兜底

    Step 3: 如果用户无 Settings 或无 api_key → 尝试环境变量兜底
      - RERANK_API_KEY / RERANK_BASE_URL / RERANK_MODEL
      - WRITING_SKILL_RERANK_API_KEY / BASE_URL / MODEL (向后兼容)

    Step 4: 均无配置 → 返回 None（静默降级，保持原排序）
    """
```

#### 3.3.2 与现有配置模式的对齐

| 配置项 | MemoryService (Embedding) | WritingSkillIndex (现有) | RerankerService (新增) |
|--------|---------------------------|--------------------------|------------------------|
| API Key | `settings.api_key` | `settings.api_key` | `settings.api_key` |
| Base URL | `settings.api_base_url` | `settings.api_base_url` | `settings.api_base_url` |
| 模型名 | `preferences.embedding_model` | `preferences.writing_skill_rerank_model` | `preferences.rerank_model` |
| 环境变量兜底 | `NOVEL_MIGRATED_EMBEDDING_*` | `WRITING_SKILL_RERANK_*` | `RERANK_*` |
| 配置缓存 | `TimedOrderedCache` TTL 120s | `_user_config_cache` | `TimedOrderedCache` TTL 120s |

**关键设计**：`api_key` 和 `api_base_url` 与 Embedding **共用**同一份用户配置，不需要用户单独配置 Reranker 的密钥和地址。用户只需在 preferences 中指定 `rerank_model` 即可启用 Reranker。

#### 3.3.3 用户级开关

在 `preferences` JSON 中增加 `rerank_enabled` 字段：

```json
{
  "rerank_model": "BAAI/bge-reranker-v2-m3",
  "rerank_enabled": "true"
}
```

- `rerank_enabled` 未设置或为 `"true"`/`"1"` → 启用 Reranker
- `rerank_enabled` 为 `"false"`/`"0"` → 禁用 Reranker（即使有模型配置）
- 此开关允许用户在配置了 Reranker 模型后仍可随时关闭

#### 3.3.4 配置解析伪代码

```python
async def _resolve_config(self, user_id: str | None) -> _RerankConfig | None:
    # --- Step 1: 用户 Settings 表 ---
    if user_id:
        cached = self._config_cache.get_entry(user_id)
        if cached is not None:
            return cached.value

        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Settings).where(Settings.user_id == user_id)
                )
                settings = result.scalar_one_or_none()

            if settings and settings.api_key:
                preferences = _load_preferences(settings)
                enabled = preferences.get("rerank_enabled", "true")
                if str(enabled).lower() in ("false", "0", "no", "off"):
                    self._config_cache.set(user_id, None)
                    return None

                api_key = safe_decrypt(settings.api_key) or ""
                base_url = _normalize_base_url(settings.api_base_url)
                model = _read_preference_string(
                    preferences,
                    ("rerank_model", "reranker_model", "rerankModel"),
                )

                # 用户有 api_key 但无 rerank_model → 环境变量兜底 model
                if not model:
                    model = os.getenv("RERANK_MODEL", "").strip()

                if api_key and base_url and model:
                    config = _RerankConfig(api_key=api_key, base_url=base_url, model=model)
                    self._config_cache.set(user_id, config)
                    return config
        except Exception as exc:
            logger.warning("⚠️ 读取用户 Rerank 配置失败: %s", exc)

        self._config_cache.set(user_id, None)
        return None

    # --- Step 2: 环境变量兜底（部署级，无 user_id 时） ---
    # 优先使用通用环境变量
    api_key = os.getenv("RERANK_API_KEY", "").strip()
    base_url = os.getenv("RERANK_BASE_URL", "").strip()
    model = os.getenv("RERANK_MODEL", "").strip()

    # 向后兼容：模块专用环境变量
    if not api_key:
        api_key = os.getenv("WRITING_SKILL_RERANK_API_KEY", "").strip()
    if not base_url:
        base_url = os.getenv("WRITING_SKILL_RERANK_BASE_URL", "").strip()
    if not model:
        model = os.getenv("WRITING_SKILL_RERANK_MODEL", "").strip()

    if not api_key or not base_url or not model:
        return None

    return _RerankConfig(api_key=api_key, base_url=base_url.rstrip("/"), model=model)
```

### 3.4 API 调用协议

遵循 Jina/Cohere/OpenAI 兼容的 `/rerank` 端点标准：

```python
# 请求
POST {base_url}/rerank
Headers: Authorization: Bearer {api_key}
Body: {
    "model": "{model_name}",
    "query": "{query_text}",
    "documents": ["doc1", "doc2", ...],
    "top_n": N  # 可选
}

# 响应
{
    "results": [
        {"index": 2, "relevance_score": 0.95},
        {"index": 0, "relevance_score": 0.82},
        ...
    ]
}
```

### 3.5 环境变量汇总

> **注意**：环境变量仅作**部署级兜底**，当用户 Settings 表中无配置时才使用。
> 正常使用场景下，用户在前端配置 API Key + Base URL + Rerank Model 即可，无需设置环境变量。

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `RERANK_API_KEY` | 部署级 Reranker API 密钥（无用户配置时兜底） | 空（降级） |
| `RERANK_BASE_URL` | 部署级 Reranker 服务基址（无用户配置时兜底） | 空（降级） |
| `RERANK_MODEL` | 部署级 Reranker 模型名（用户有 api_key 但无 rerank_model 时兜底） | 空 |
| `RERANK_TIMEOUT_SECONDS` | Reranker 请求超时（秒） | `10` |
| `RERANK_MAX_DOCUMENTS` | 单次最大文档数 | `50` |
| `RERANK_ENABLED` | 部署级全局开关（`0`/`false` 禁用，影响所有用户） | `1` |
| `WRITING_SKILL_RERANK_*` | 写作技能专用（向后兼容，优先级低于通用） | 保留 |

---

## 四、各模块接入方案

---

### P0-1：小说记忆服务（MemoryService）

**文件**：`backend/app/gateway/novel_migrated/services/memory_service.py`

#### 当前检索流程

```
search_memories()
  ├─ 有 embedding → ChromaDB.query() → cosine similarity 过滤 → 返回
  └─ 无 embedding → _fallback_store 遍历 → _fallback_score 排序 → 返回
```

#### 接入后检索流程

```
search_memories()
  ├─ 有 embedding → ChromaDB.query(n_results=limit*2) → cosine similarity 过滤
  │                  → Reranker 精排 → 取 top limit → 返回
  └─ 无 embedding → _fallback_store 遍历 → _fallback_score 排序
                     → Reranker 精排 → 取 top limit → 返回
```

#### 具体改动

**1. 新增 `_reranker_service` 属性**

```python
class MemoryService:
    def __init__(self):
        # ... 现有初始化 ...
        self._reranker_service: RerankerService | None = None

    @property
    def reranker(self) -> RerankerService:
        if self._reranker_service is None:
            from app.gateway.novel_migrated.services.reranker_service import RerankerService
            self._reranker_service = RerankerService.get_instance()
        return self._reranker_service
```

**2. 修改 `search_memories()` 方法**

在向量检索和降级检索的**返回前**，增加 Rerank 步骤：

```python
async def search_memories(self, user_id, project_id, query,
                          memory_types=None, limit=20, min_similarity=0.35):
    # ... 现有检索逻辑，获取 output 列表 ...

    # === 新增：Reranker 精排 ===
    if output and len(output) > 1:
        try:
            documents = [item["content"] for item in output]
            rerank_results = await self.reranker.async_rerank(
                query=query,
                documents=documents,
                user_id=user_id,
                top_n=limit,
            )
            if rerank_results:
                reranked = []
                for result in rerank_results:
                    if 0 <= result.index < len(output):
                        item = output[result.index]
                        item["similarity"] = result.relevance_score
                        reranked.append(item)
                output = reranked
        except Exception as exc:
            logger.warning("⚠️ 记忆 Rerank 失败，保持原排序: %s", exc)

    return output[:limit]
```

**3. ChromaDB 查询扩大召回量**

```python
# 修改前
results = collection.query(query_embeddings=[query_embedding], n_results=limit, ...)

# 修改后：扩大召回量，为 Rerank 留出精排空间
overfetch = min(limit * 2, 50)  # 最多多召回 50 条
results = collection.query(query_embeddings=[query_embedding], n_results=overfetch, ...)
```

#### 影响范围

| API 端点 | 影响 |
|----------|------|
| `POST /api/memories/projects/{id}/search` | 直接受益，排序更精准 |
| `GET /api/memories/projects/{id}/foreshadows` | 伏笔检索质量提升 |
| `ChapterContextService._get_relevant_memories_enhanced()` | 章节上下文记忆更相关 |
| `author_control._rag()` | RAG 检索结果质量提升 |

#### 预期收益

- **伏笔回收**：理解因果关联而非字面匹配，减少"看似相关实则无关"的记忆
- **角色关系**：准确检索与当前角色有互动关系的记忆，而非仅名字相同
- **情节连贯性**：减少因低相关度记忆注入导致的 LLM 幻觉

---

### P0-2：RAG 上下文组装（NovelContextAssembler）

**文件**：`backend/app/gateway/novel_migrated/api/author_control.py` + `novel_context_assembler.py`

#### 当前流程

```
author_control._rag()
  → memory_service.search_memories(limit=8)
  → 直接返回 → NovelContextAssembler 注入 <novel_rag_results>
```

#### 接入方案

**采用方案 B（零改动，依赖 P0-1 的 MemoryService 内部 Rerank 自动生效）**

P0-1 已在 `MemoryService.search_memories()` 内部集成了 Rerank，RAG 管线调用 `memory_service.search_memories()` 时自动获得精排效果，无需额外改动。

**不采用方案 A（二次 Rerank）的理由**：
- 二次 Rerank 会增加 API 成本和延迟，收益有限
- MemoryService 内部的 Rerank 已使用 `query` 做精排，与 RAG 管线的 query 一致
- 如果后续发现 RAG 管线需要更丰富的上下文（如项目标题+章节大纲+用户指令）做 Rerank，
  可在 P0-1 稳定后作为增量优化，当前不必要

---

### P1：意图识别引擎（IntentDecisionEngine）

**文件**：`backend/app/gateway/middleware/intent_components.py`

#### 当前评分方式

```python
execute_confidence = clip01(0.50 * rule_execute + 0.35 * semantic_execute + 0.15 * slot_score)
qa_confidence       = clip01(0.60 * rule_qa + 0.40 * semantic_qa)
```

其中 `semantic_*` 由本地 `sentence-transformers` 计算，精度有限。

#### 接入方案

**仅在置信度接近阈值边界时触发 Rerank**（避免每次请求都调用，控制延迟和成本）：

```python
class IntentDecisionEngine:
    def __init__(self, *, ...):
        # ... 现有初始化 ...
        self._reranker_service: RerankerService | None = None

    @property
    def reranker(self) -> RerankerService | None:
        if self._reranker_service is None:
            from app.gateway.novel_migrated.services.reranker_service import RerankerService
            self._reranker_service = RerankerService.get_instance()
        return self._reranker_service

    def decide(self, *, user_message, session_mode, slots_complete,
               execution_mode_active, pending_action_exists):
        # ... 现有规则+语义评分 ...

        # === 新增：边界 case Rerank ===
        # 仅当 execute 和 qa 置信度接近时（差距 < 0.15）才触发
        ambiguity = 1.0 - abs(execute_confidence - qa_confidence)
        if ambiguity > 0.85 and self.reranker is not None:
            try:
                # 将用户消息与各类意图的 exemplar 做重排序
                exemplar_docs = []
                for category, exemplars in self._exemplars.items():
                    for exemplar in exemplars:
                        exemplar_docs.append(f"[{category}] {exemplar}")

                rerank_results = self.reranker.rerank(
                    query=user_message,
                    documents=exemplar_docs,
                    top_n=5,
                )
                if rerank_results:
                    # 根据 Rerank 结果调整语义分数
                    category_scores: dict[str, float] = {}
                    for r in rerank_results:
                        doc = exemplar_docs[r.index]
                        category = doc.split("]")[0].strip("[")
                        category_scores[category] = max(
                            category_scores.get(category, 0.0),
                            r.relevance_score,
                        )
                    # 用 Rerank 分数微调语义分数（权重 0.3）
                    if "create" in category_scores or "manage" in category_scores:
                        semantic_execute = clip01(
                            0.7 * semantic_execute + 0.3 * max(
                                category_scores.get("create", 0.0),
                                category_scores.get("manage", 0.0),
                            )
                        )
                    if "qa" in category_scores:
                        semantic_qa = clip01(
                            0.7 * semantic_qa + 0.3 * category_scores["qa"]
                        )
                    # 重新计算置信度
                    execute_confidence = clip01(
                        0.50 * rule_execute + 0.35 * semantic_execute + 0.15 * slot_score
                    )
                    qa_confidence = clip01(0.60 * rule_qa + 0.40 * semantic_qa)
            except Exception as exc:
                logger.warning("意图 Rerank 失败，保持原评分: %s", exc)

        # ... 后续阈值判断逻辑不变 ...
```

#### 触发条件

- `ambiguity > 0.85`（execute 和 qa 置信度差距 < 0.15）
- Reranker 配置可用
- 预计仅 10-20% 的请求会触发，控制成本

#### 预期收益

- 模糊输入（如"帮我改一下"）的意图判断更准确
- 减少误判导致的错误路由

---

### P2：DeerFlow 核心记忆

**文件**：`backend/packages/harness/deerflow/agents/memory/storage.py` + `prompt.py`

#### 当前方式

- 纯文件 I/O 存储，`memory.json` 包含 facts 列表
- 注入时按 `confidence` 排序，取 top 15 facts
- `max_injection_tokens = 2000`

#### 接入方案

**在 `format_memory_for_injection()` 中增加 Rerank**：

```python
# backend/packages/harness/deerflow/agents/memory/prompt.py

def format_memory_for_injection(memory_data: dict, *, max_tokens: int = 2000,
                                  current_context: str = "") -> str:
    facts = memory_data.get("facts", [])
    if not facts:
        return ""

    # 如果有当前上下文且 facts 数量 > 5，使用 Rerank 筛选
    if current_context and len(facts) > 5:
        try:
            from app.gateway.novel_migrated.services.reranker_service import RerankerService
            reranker = RerankerService.get_instance()
            documents = [f["content"] for f in facts]
            rerank_results = reranker.rerank(
                query=current_context,
                documents=documents,
                top_n=15,
            )
            if rerank_results:
                facts = [facts[r.index] for r in rerank_results
                         if 0 <= r.index < len(facts)]
        except Exception:
            pass  # 静默降级

    # ... 后续按 confidence 排序 + token 截断逻辑不变 ...
```

#### 注意事项

- **harness/app 边界**：`packages/harness/` 不能导入 `app.*`（CI 强制检查）
- **解决方案**：在 `deerflow/agents/memory/prompt.py` 中定义 `RerankProvider` 协议（Protocol），由 `app/` 层注入实现
- 工程量较大，优先级 P2

```python
# deerflow/agents/memory/prompt.py
from typing import Protocol

class RerankProvider(Protocol):
    def rerank(self, query: str, documents: list[str],
               *, top_n: int | None = None) -> list[tuple[int, float]]: ...

# 全局注入点
_rerank_provider: RerankProvider | None = None

def set_rerank_provider(provider: RerankProvider | None) -> None:
    global _rerank_provider
    _rerank_provider = provider
```

---

### P3：AI Creator（TypeScript）

**文件**：`技能/ai_creator-main/apps/server/src/services/embeddingService.ts`

#### 当前方式

- MongoDB Atlas Vector Search 的 `$vectorSearch` 聚合管道
- 支持 6 个集合：characters, world_settings, drafts, chapters, skills, skill_drafts
- 降级为 regex 搜索

#### 接入方案

**在 TypeScript 侧实现 Reranker 调用**：

```typescript
// 技能/ai_creator-main/apps/server/src/services/rerankerService.ts

interface RerankResult {
  index: number;
  relevance_score: number;
}

class RerankerService {
  private apiKey: string | null;
  private baseUrl: string | null;
  private model: string | null;

  constructor() {
    this.apiKey = process.env.RERANK_API_KEY || null;
    this.baseUrl = process.env.RERANK_BASE_URL || null;
    this.model = process.env.RERANK_MODEL || null;
  }

  async rerank(
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<RerankResult[]> {
    if (!this.apiKey || !this.baseUrl || !this.model) return [];

    const payload: Record<string, unknown> = {
      model: this.model,
      query,
      documents,
    };
    if (topN) payload.top_n = topN;

    const resp = await fetch(`${this.baseUrl}/rerank`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return data.results || [];
  }
}
```

**在 `embeddingService.ts` 的 `vectorSearch()` 后增加 Rerank 步骤**：

```typescript
// 现有 vectorSearch 返回结果后
if (results.length > 1 && rerankerService) {
  const documents = results.map(r => r.name || r.title || "");
  const reranked = await rerankerService.rerank(query, documents, limit);
  if (reranked.length > 0) {
    results = reranked
      .filter(r => r.index < results.length)
      .map(r => results[r.index]);
  }
}
```

#### 注意事项

- TypeScript 侧与 Python 侧的 Reranker 是**独立实现**，但共享同一套环境变量
- AI Creator 使用 MongoDB 而非 ChromaDB，Rerank 在向量搜索后执行
- 优先级 P3，因为 AI Creator 是独立子系统

#### TypeScript 侧的用户配置模型差异

> **重要**：AI Creator (TypeScript) 使用 **MongoDB + JWT** 的用户体系，
> 与 Python 侧的 **SQLAlchemy Settings 表** 完全不同。
> 因此 TypeScript 侧的 Reranker 配置不能直接复用 Python 侧的 per-user Settings。

TypeScript 侧的配置策略：

```
TypeScript Reranker 配置优先级：
1. 请求中的 user_id → 查询 MongoDB 用户配置
   （需在 MongoDB User 或 AIConfig 集合中增加 rerank_model 字段）
2. 环境变量 RERANK_API_KEY/BASE_URL/MODEL 兜底
3. 无配置 → 静默降级
```

这意味着 P3 的工程量比预估更大——需要在 MongoDB 侧增加用户级 Reranker 配置的存储和读取。
如果 AI Creator 当前用户量不大，可先仅使用环境变量兜底，后续再增加 MongoDB 用户配置。

---

## 五、写作技能索引迁移

### 5.1 迁移目标

将 `writing_skill_index.py` 中的 `_RerankBackend` 替换为通用 `RerankerService`。

### 5.2 迁移步骤

1. `WritingSkillIndex.__init__()` 中将 `self._rerank_backend = _RerankBackend()` 替换为 `self._reranker_service = RerankerService.get_instance()`
2. `search_candidates()` 中将 `self._rerank_backend.rerank(query, entries)` 替换为 `self._reranker_service.rerank(query, documents)`
3. 保留 `WRITING_SKILL_RERANK_*` 环境变量作为 fallback（在 `RerankerService._resolve_config()` 中处理）
4. 删除 `_RerankBackend` 类

### 5.3 注意：`_UserModelConfig` 不能删除

`_UserModelConfig` 被 `_VectorSearchBackend` 和 `WritingSkillUserConfig` 共用（共 16 处引用），不能删除。
迁移后仅删除 `_RerankBackend` 类本身，`_UserModelConfig` 和 `WritingSkillUserConfig` 保留给 `_VectorSearchBackend` 使用。

### 5.4 注意：同步/异步兼容

`WritingSkillIndex.search_candidates()` 是**同步方法**，但新的 `RerankerService.async_rerank()` 是异步的。
`RerankerService` 必须提供**同步版本** `rerank()`，内部处理事件循环兼容：

```python
def rerank(self, query: str, documents: list[str], *,
           user_id: str | None = None, top_n: int | None = None) -> list[RerankResult]:
    """同步版本 - 兼容 WritingSkillIndex.search_candidates() 等同步调用方。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None and loop.is_running():
        # 已有事件循环（如 FastAPI 请求上下文），使用 run_coroutine_threadsafe
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, self.async_rerank(query, documents, user_id=user_id, top_n=top_n))
            return future.result(timeout=_RERANK_TIMEOUT_SECONDS)
    else:
        # 无事件循环，直接 asyncio.run
        return asyncio.run(self.async_rerank(query, documents, user_id=user_id, top_n=top_n))
```

### 5.5 向后兼容

- `WRITING_SKILL_RERANK_API_KEY` → 优先级高于 `RERANK_API_KEY`
- `WRITING_SKILL_RERANK_BASE_URL` → 优先级高于 `RERANK_BASE_URL`
- `WRITING_SKILL_RERANK_MODEL` → 优先级高于 `RERANK_MODEL`
- 用户 Settings 表中的 `writing_skill_rerank_model` → 优先级最高

---

## 六、前端 UI 变更

### 6.1 设置页面增加 Reranker 配置入口

在用户设置页面（对应 `AISettingsService`）中增加以下配置项：

| 配置项 | 字段名 | 类型 | 说明 |
|--------|--------|------|------|
| 重排序模型 | `rerank_model` | 文本输入 | Reranker 模型名，如 `BAAI/bge-reranker-v2-m3` |
| 启用重排序 | `rerank_enabled` | 开关 | 默认开启，用户可随时关闭 |

**UI 布局建议**：

```
┌─────────────────────────────────────────────┐
│  AI 设置                                     │
│                                             │
│  API 密钥:     [sk-xxxxx          ]  (已有)   │
│  API 基址:     [https://api.xxx   ]  (已有)   │
│                                             │
│  ─── 重排序模型 ──────────────────────────── │
│  重排序模型:   [BAAI/bge-reranker-v2-m3]      │
│  启用重排序:   [✓]                            │
│                                             │
│  ─── 嵌入模型 ───────────────────────────── │
│  嵌入模型:     [text-embedding-3-small] (已有) │
└─────────────────────────────────────────────┘
```

### 6.2 后端 API 变更

在 `AISettingsService` 中增加 `rerank_model` 和 `rerank_enabled` 的读写支持：

- `GET /api/settings` 响应中增加 `preferences.rerank_model` 和 `preferences.rerank_enabled`
- `PUT /api/settings` 请求中接受 `preferences.rerank_model` 和 `preferences.rerank_enabled`
- `_save_preferences()` 和 `_load_preferences()` 无需改动（已支持任意 JSON 字段）

### 6.3 推荐模型列表

前端可提供下拉选择，预置常用 Reranker 模型：

| 模型名 | 说明 |
|--------|------|
| `BAAI/bge-reranker-v2-m3` | 多语言，中文优秀（推荐） |
| `jina-reranker-v2-base-multilingual` | Jina AI 多语言 |
| `cohere/rerank-v3` | Cohere 高精度 |
| （自定义输入） | 用户自行输入模型名 |

---

## 七、实施计划

### Phase 1：基础设施（1-2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 创建 `RerankerService` | `app/gateway/services/reranker_service.py` | 通用重排序服务（含同步/异步双接口） |
| 编写单元测试 | `tests/test_reranker_service.py` | 配置解析、降级、API 调用 mock、同步/异步兼容 |
| 迁移写作技能 Reranker | `packages/harness/deerflow/skills/writing_skill_index.py` | 替换 `_RerankBackend`，保留 `_UserModelConfig` |
| 前端设置页面增加 Reranker 入口 | 前端设置组件 | `rerank_model` + `rerank_enabled` |

### Phase 2：P0 接入（2-3 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| MemoryService 接入 Rerank | `app/gateway/novel_migrated/services/memory_service.py` | `search_memories()` 增加精排 |
| ChromaDB 扩大召回量 | 同上 | `n_results=limit*2` |
| 编写集成测试 | `tests/test_memory_rerank.py` | 验证 Rerank 效果和降级 |
| RAG 管线验证 | `author_control.py` | 验证 P0-1 的 Rerank 自动生效（零改动） |

### Phase 3：P1 接入（1-2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| IntentDecisionEngine 接入 | `app/gateway/middleware/intent_components.py` | 边界 case Rerank |
| 编写测试 | `tests/test_intent_rerank.py` | 验证边界 case 改善 |

### Phase 4：P2 接入（2-3 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 定义 `RerankProvider` 协议 | `packages/harness/deerflow/agents/memory/prompt.py` | Protocol + 注入点 |
| 实现注入 | `app/gateway/` 某处 | 将 RerankerService 注入 harness |
| 修改 `format_memory_for_injection()` | 同上 | 增加 Rerank 筛选 |
| 编写测试 | `tests/test_memory_injection_rerank.py` | 验证 facts 筛选 |

### Phase 5：P3 接入（2-3 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| TypeScript RerankerService | `技能/ai_creator-main/apps/server/src/services/rerankerService.ts` | 独立实现 |
| embeddingService 集成 | `技能/ai_creator-main/apps/server/src/services/embeddingService.ts` | vectorSearch 后 Rerank |
| 编写测试 | 手动验证 | TypeScript 侧无自动化测试 |

---

## 七、性能与成本分析

### 7.1 延迟影响

| 模块 | Rerank 调用频率 | 预计增加延迟 | 可接受性 |
|------|----------------|-------------|----------|
| 小说记忆 | 每次搜索 1 次 | 100-500ms | ✅ 可接受（非实时交互） |
| RAG 管线 | 每次生成 1 次 | 100-500ms | ✅ 可接受（生成本身 5-30s） |
| 意图识别 | 10-20% 请求触发 | 100-500ms | ⚠️ 需监控（用户等待中） |
| 核心记忆 | 每次对话 1 次 | 100-500ms | ✅ 可接受（后台注入） |
| AI Creator | 每次搜索 1 次 | 100-500ms | ✅ 可接受 |

### 7.2 API 成本

- Reranker API 通常按 token 计费，约 $0.001-0.01/次
- 预计每日调用量：100-500 次（取决于用户活跃度）
- 月成本估算：$3-150

### 7.3 成本控制策略

1. **开关控制**：`RERANK_ENABLED=0` 可全局禁用
2. **阈值触发**：意图识别仅在边界 case 触发
3. **文档数限制**：`RERANK_MAX_DOCUMENTS=50` 防止过多文档
4. **缓存**：相同 query+documents 的 Rerank 结果可缓存（TTL 5min）
5. **配额感知**：用户向量配额不足时跳过 Rerank

---

## 八、测试策略

### 8.1 单元测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `test_reranker_service.py` | 配置解析优先级、API 调用 mock、降级逻辑、超时处理 |
| `test_memory_rerank.py` | MemoryService Rerank 集成、降级、overfetch |
| `test_intent_rerank.py` | 边界 case 触发、评分调整、降级 |
| `test_memory_injection_rerank.py` | facts 筛选、Protocol 注入、降级 |

### 8.2 集成测试

- 端到端验证：用户输入 → 意图识别 → RAG 检索 → 记忆注入 → 生成输出
- 降级测试：模拟 Reranker 不可用，验证所有功能正常
- 性能测试：Reranker 延迟对整体响应时间的影响

### 8.3 A/B 测试建议

- 对比有/无 Reranker 的记忆检索精度（人工评估）
- 对比有/无 Reranker 的意图识别准确率
- 监控 Reranker 对生成质量的影响（用户反馈）

---

## 九、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Reranker API 不可用 | 中 | 低 | 静默降级为原排序 |
| Reranker 延迟过高 | 低 | 中 | 超时控制（10s）+ 异步调用 |
| API 成本超预期 | 低 | 中 | 开关控制 + 配额限制 |
| harness/app 边界违反 | 低 | 高 | Protocol 注入模式 |
| Rerank 结果比原排序差 | 低 | 中 | A/B 测试 + 可配置权重 |
| TypeScript 侧独立维护成本 | 中 | 低 | 共享环境变量 + 统一 API 协议 |

---

## 十、配置示例

### 10.1 用户级配置（推荐，前端设置）

用户在前端"设置"页面配置以下信息即可启用 Reranker：

```
API Key:        sk-xxxxx（与 Embedding/LLM 共用）
API Base URL:   https://api.siliconflow.cn/v1（与 Embedding/LLM 共用）
```

在 `preferences` JSON 中指定 Reranker 模型：

```json
{
  "rerank_model": "BAAI/bge-reranker-v2-m3",
  "rerank_enabled": "true"
}
```

**说明**：
- `api_key` 和 `api_base_url` 与 Embedding/LLM **共用**，用户无需重复配置
- 只需在 preferences 中添加 `rerank_model` 即可启用 Reranker
- `rerank_enabled` 可随时关闭 Reranker 而不删除模型配置

### 10.2 环境变量配置（部署级兜底）

> 仅在用户未配置 Settings 时使用，适合自部署/开发环境。

```bash
# 部署级 Reranker 配置（所有未配置 Settings 的用户共享）
RERANK_API_KEY=sk-xxxxx
RERANK_BASE_URL=https://api.siliconflow.cn/v1
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_TIMEOUT_SECONDS=10
RERANK_MAX_DOCUMENTS=50
RERANK_ENABLED=1

# 写作技能专用（向后兼容，优先级低于通用配置）
WRITING_SKILL_RERANK_API_KEY=sk-xxxxx
WRITING_SKILL_RERANK_BASE_URL=https://api.siliconflow.cn/v1
WRITING_SKILL_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### 10.3 配置优先级总结

```
用户 A（有 Settings）:
  api_key=sk-aaa, api_base_url=https://api.siliconflow.cn/v1
  preferences: {"rerank_model": "BAAI/bge-reranker-v2-m3"}
  → 使用用户 A 自己的配置 ✅

用户 B（有 Settings，但无 rerank_model）:
  api_key=sk-bbb, api_base_url=https://api.siliconflow.cn/v1
  preferences: {}
  → api_key/base_url 用用户 B 的，model 用 RERANK_MODEL 环境变量兜底 ✅

用户 C（无 Settings）:
  → 使用 RERANK_API_KEY/BASE_URL/MODEL 环境变量兜底 ✅

用户 D（有 Settings，但 rerank_enabled=false）:
  → 不使用 Reranker，保持原排序 ✅
```

---

## 附录 A：现有 Reranker 实现参考

当前 `_RerankBackend` 位于 `writing_skill_index.py` 第 426-535 行，核心逻辑：

1. 配置来源：环境变量 → 用户 Settings 表
2. API 调用：`POST {base_url}/rerank`，payload 包含 `model`、`query`、`documents`
3. 响应解析：`results[].index` + `results[].relevance_score`
4. 降级策略：配置缺失或 API 失败时返回空 dict，调用方保持原排序
5. 超时：`_RERANK_TIMEOUT_SECONDS`（默认 15s）
6. 同步调用：使用 `httpx.Client`（同步），在 `search_candidates()` 中通过 `asyncio.run()` 包装

通用 `RerankerService` 将在此基础上改进：
- 改为 `httpx.AsyncClient` 长连接复用
- 增加 `async_rerank()` 原生异步接口
- 增加配置缓存（TTL 120s）
- 增加 `top_n` 参数支持
- 增加全局开关

---

## 附录 B：推荐 Reranker 模型

| 模型 | 提供方 | 特点 | 适用场景 |
|------|--------|------|----------|
| `BAAI/bge-reranker-v2-m3` | SiliconFlow/自部署 | 多语言支持好，中文优秀 | 通用推荐 |
| `jina-reranker-v2-base-multilingual` | Jina AI | 多语言，API 稳定 | 云端调用 |
| `cohere/rerank-v3` | Cohere | 精度高，支持中文 | 高精度需求 |
| `bce-reranker-base_v1` | 自部署 | 开源免费，中文优化 | 本地部署 |

---

## 附录 C：文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新建** | `backend/app/gateway/services/reranker_service.py` | 通用 Reranker 服务（含同步/异步双接口） |
| **新建** | `backend/tests/test_reranker_service.py` | Reranker 服务单元测试 |
| **修改** | `backend/app/gateway/novel_migrated/services/memory_service.py` | search_memories 增加 Rerank |
| **修改** | `backend/app/gateway/middleware/intent_components.py` | 意图识别边界 Rerank |
| **修改** | `backend/packages/harness/deerflow/skills/writing_skill_index.py` | 迁移到通用 RerankerService（保留 `_UserModelConfig`） |
| **修改** | `backend/packages/harness/deerflow/agents/memory/prompt.py` | 增加 RerankProvider 协议 |
| **修改** | 前端设置页面组件 | 增加 `rerank_model` + `rerank_enabled` 配置入口 |
| **新建** | `技能/ai_creator-main/apps/server/src/services/rerankerService.ts` | TypeScript Reranker（独立用户配置模型） |
| **修改** | `技能/ai_creator-main/apps/server/src/services/embeddingService.ts` | vectorSearch 后 Rerank |
