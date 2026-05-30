# 重排序模型（Reranker）接入执行方案

> 版本：v1.3  
> 日期：2026-05-30  
> 状态：已按当前代码基线修订，可作为实施文档使用

## 一、先给结论

这份方案在方向上是对的，但 **v1.2 不能直接照做**，原因不是思路错，而是它对当前项目现状有几处关键误判：

1. **前端配置入口判断过于理想化**  
   当前并不是一个“简单设置页字段表单”，而是基于多 Provider 的 `AIProviderStore` / `AISettingsService` 统一模型。
2. **Writing Skill 的 Rerank 仍是模块内私有实现**  
   目前 `writing_skill_index.py` 里仍然存在 `_RerankBackend`，还没有真的迁到通用服务。
3. **`MemoryService.search_memories()` 还没有为精排做 overfetch**  
   现在向量检索仍是 `n_results=limit`，如果直接接 Rerank，精排空间很有限。
4. **harness / app 分层约束被低估**  
   `packages/harness/*` 不能直接依赖 `app.*` 是硬边界，核心记忆那部分不能按“直接 import 通用服务”来写。
5. **同步包装方案写得太激进**  
   文档里建议在同步方法里套线程池 + `asyncio.run()`，这不是当前项目里最稳的实现方式，复杂且有额外风险。

所以这份文档已经改成：**只保留当前项目真正可执行的步骤，删除或降级掉不符合代码现状的设计。**

---

## 二、当前代码基线

下面这些是我已经按真实代码核对过的事实。

### 2.1 Writing Skill 现状

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\packages\harness\deerflow\skills\writing_skill_index.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\packages\harness\deerflow\skills\writing_skill_index.py)
- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\packages\harness\deerflow\tools\builtins\writing_skill_tools.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\packages\harness\deerflow\tools\builtins\writing_skill_tools.py)

现状：

- 已有 `_VectorSearchBackend`
- 已有 `_RerankBackend`
- 已支持从 `Settings` 里读取用户级 embedding / rerank 模型
- 工具层 `list_writing_skill_candidates` 已经会先 `load_writing_skill_user_config(user_id)`
- `search_candidates()` 仍是**同步方法**
- 当前 Rerank 调用仍在 `WritingSkillIndex` 内部完成，**还不是通用服务**

### 2.2 MemoryService 现状

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\memory_service.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\memory_service.py)

现状：

- 已有 `TimedOrderedCache`
- 已有用户级 embedding 配置解析
- 已复用长生命周期 `httpx.AsyncClient`
- `search_memories()` 是 **async**
- 向量搜索当前仍是：
  - `collection.query(..., n_results=limit, ...)`
  - 然后直接返回
- 这意味着如果要加 Rerank，应该先做 **overfetch**

### 2.3 AI 设置现状

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\ai_settings_service.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\ai_settings_service.py)
- [N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend\src\components\novel\settings\ProviderSettings.tsx](N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend\src\components\novel\settings\ProviderSettings.tsx)

现状：

- 后端不是“自由散落字段”，而是 `preferences.ai_provider_settings`
- 前端不是传统平铺表单，而是 provider 列表编辑器
- 如果要让用户选 embedding / rerank 模型，应该优先考虑：
  - 复用现有 provider / feature routing / preferences 体系
  - 而不是单独加一组游离字段破坏结构

### 2.4 意图识别现状

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\middleware\intent_components.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\middleware\intent_components.py)
- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\middleware\intent_recognition_middleware.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\middleware\intent_recognition_middleware.py)

现状：

- 当前语义判断主要依赖本地 sentence-transformers
- 模型名来自环境变量
- 没有现成的“用户级 rerank 配置接入口”
- 这部分不是不能做，而是**不应放在第一阶段**

---

## 三、修订后的总体原则

1. **先把 Writing Skill 和 MemoryService 做实，再谈全模块推广**  
   这两处最接近现有架构，也最能直接产生收益。
2. **用户可选模型优先，环境变量只做兜底**  
   这一点必须保留，且已经符合当前写作技能的实际方向。
3. **同步调用方不要硬塞复杂 async bridge**  
   对同步侧先保留同步 HTTP 实现，或做边界清晰的包装；不要用线程池套 `asyncio.run()` 当默认方案。
4. **不跨越 harness / app 边界**  
   `packages/harness/*` 如果要复用能力，只能通过协议/注入/纯数据接口，不直接 import `app.*`。
5. **前端只做必要配置暴露，不重构整套 AI Settings UI**  
   先走最小增量。

---

## 四、可执行的分阶段方案

## Phase 0：收敛现有 Writing Skill 实现

目标：先把当前已经存在的写作技能 Rerank 能力定型，而不是立即抽象成全站通用服务。

### 要做什么

1. 保留 `writing_skill_index.py` 中的用户级配置模式
2. 把 `_RerankBackend` 做成更稳定的可复用内部组件
3. 明确它的输入输出契约，供后续抽通用服务时平移
4. 补齐测试，确保：
   - 用户 `Settings.preferences` 中的 `writing_skill_rerank_model` 可生效
   - 用户没有配置时才走环境变量兜底
   - `/rerank` 失败时静默降级

### 为什么先这样做

因为当前代码已经在线路上跑通了 Writing Skill 的用户级模型选择。如果这一步还没完全固化，就贸然抽“通用 RerankerService”，很容易把现有可用链路重新打散。

### 当前建议

- **不在这一阶段强制删除 `_RerankBackend`**
- 先把它视为“通用服务前的稳定原型”

---

## Phase 1：抽取通用 `RerankerService`

目标：把 Writing Skill 中已经验证过的 Rerank 能力抽到 Gateway 通用服务层。

### 推荐文件位置

`backend/app/gateway/services/reranker_service.py`

这个路径是合理的，原因如下：

- 不只给 `novel_migrated` 用
- 后续 MemoryService、意图识别、其他 Gateway 能力都可复用
- 避免把“通用能力”错误塞进 `novel_migrated/services/`

### 服务职责

`RerankerService` 应只做三件事：

1. 解析配置
2. 调用 `/rerank`
3. 返回稳定、可降级的排序结果

### 推荐接口

```python
@dataclass(frozen=True)
class RerankResult:
    index: int
    relevance_score: float


class RerankerService:
    @classmethod
    def get_instance(cls) -> "RerankerService": ...

    async def async_rerank(
        self,
        query: str,
        documents: list[str],
        *,
        user_id: str | None = None,
        top_n: int | None = None,
        config: RerankUserConfig | None = None,
    ) -> list[RerankResult]: ...

    def rerank_sync(
        self,
        query: str,
        documents: list[str],
        *,
        config: RerankUserConfig | None = None,
        top_n: int | None = None,
    ) -> list[RerankResult]: ...
```

### 关键修订点

这里我把文档里的同步接口从 `rerank()` 改成了 **`rerank_sync()`**，目的是减少误用。

原因：

- 当前项目里既有同步调用方，也有异步调用方
- 如果同名 `rerank()` 同时承担同步语义，很容易让后续维护者误判
- 明确 `async_rerank()` / `rerank_sync()` 边界更稳

### 同步包装建议

**不要采用 v1.2 里那种线程池 + `asyncio.run()` 的默认写法。**

更稳的做法是：

- `async_rerank()` 使用复用的 `httpx.AsyncClient`
- `rerank_sync()` 独立使用一次性 `httpx.Client`
- 两边共用同一套配置解析和响应解析逻辑

这样做的好处：

- 没有事件循环嵌套风险
- 行为更可预测
- 对 `WritingSkillIndex.search_candidates()` 这种同步方法最友好

---

## Phase 2：MemoryService 接入 Rerank

这是当前全站里最值得做、也最容易闭环的 P0。

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\memory_service.py](N:\miaowu-os-merge-upstream-main\deer-flow-main\backend\app\gateway\novel_migrated\services\memory_service.py)

### 正确接法

#### 1. 向量检索先 overfetch

当前代码：

```python
results = collection.query(
    query_embeddings=[query_embedding],
    n_results=limit,
    where=where_clause,
)
```

应改成：

```python
overfetch = min(max(limit * 2, limit), 50)
results = collection.query(
    query_embeddings=[query_embedding],
    n_results=overfetch,
    where=where_clause,
)
```

#### 2. 过滤后再做 Rerank

流程应该是：

```text
Chroma 召回 -> similarity threshold 过滤 -> Rerank -> 截断到 limit
```

而不是：

```text
Chroma 直接 top limit -> Rerank
```

后者精排空间太小，收益不稳定。

#### 3. fallback 路径也可接 Rerank，但优先级低于向量路径

降级检索的收益会有，但没必要一开始就把复杂度拉满。建议：

- 第一版先给向量路径加 Rerank
- fallback 路径作为可选增强

### 这一阶段不该做什么

- 不要在 `MemoryService` 里再塞一套用户配置解析
- 配置读取应复用 `RerankerService`
- 不要新起第二套缓存实现，直接复用 `TimedOrderedCache` 思路即可

---

## Phase 3：Writing Skill 从私有 `_RerankBackend` 迁移到通用服务

当 Phase 1 和 Phase 2 跑稳后，再迁。

### 迁移目标

把：

- `WritingSkillIndex._rerank_backend`

迁成：

- `RerankerService.rerank_sync(...)`

### 迁移后的预期结构

`writing_skill_index.py` 保留：

- `_UserModelConfig`
- `WritingSkillUserConfig`
- 用户偏好读取逻辑

删除：

- `_RerankBackend`

保留原因：

- `_UserModelConfig` 和 `WritingSkillUserConfig` 现在不仅被 rerank 用，也被向量搜索用户模型配置使用
- 这两类结构体不是“只为 Rerank 存在”

### 与 v1.2 不同的地方

v1.2 写的是“先抽服务，再整体替换”，这个顺序风险偏高。  
修订后顺序是：

1. 先让通用服务在 MemoryService 场景跑稳
2. 再把 Writing Skill 平移过去

这样不会在当前已可用功能上做高风险重构。

---

## Phase 4：前端配置接入

这一部分必须改写，因为 v1.2 的“设置页增加字段”说法不符合当前前端结构。

### 当前真实结构

前端主要是：

- Provider 列表编辑
- 默认 Provider
- Provider 的 model / baseUrl / apiKey

文件：

- [N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend\src\components\novel\settings\ProviderSettings.tsx](N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend\src\components\novel\settings\ProviderSettings.tsx)

### 可执行方案

**不要先改大 UI。**

先做最小可行配置：

1. 后端在 `preferences` 中支持以下键：
   - `rerank_model`
   - `rerank_enabled`
   - `writing_skill_rerank_model`
   - `writing_skill_embedding_model`
2. 前端先在现有小说设置或高级设置区增加“高级 JSON 偏好”映射入口，或增加一个小范围表单
3. 不要一上来就重构 `AIProviderStore` 数据模型

### 更合理的长期方向

长期更建议把 embedding / rerank 视为 **feature routing / provider capability** 的扩展，而不是零散偏好字段。  
但这已经超出本次方案的最低可执行范围，不应该阻塞当前接入。

---

## Phase 5：意图识别接入

这部分在 v1.2 里被放得太靠前了，现阶段应该降级为 **P1/P2 之后再做**。

原因：

1. 当前意图识别主要是本地 embedding 路线
2. 用户级 rerank 配置在这条链路上没有现成入口
3. 即使能做，收益也没有 MemoryService 和 Writing Skill 那么直接

### 结论

- 可以做
- 但不应该作为第一批落地项

---

## Phase 6：harness 核心记忆接入

这部分必须明确为 **后置项**。

### 原因

`packages/harness/*` 不能直接依赖 `app.*`。  
所以文档里那种：

```python
from app.gateway... import RerankerService
```

在该层是不可接受的。

### 可执行方案

如果未来真的要做，只能走：

1. Protocol
2. Provider 注入
3. Gateway 层组装

因此这块只能是 P2/P3，不能作为当前主线实施内容。

---

## 五、修订后的优先级

### P0

1. 固化 Writing Skill 当前用户级 Rerank 能力
2. 抽取 `RerankerService`
3. `MemoryService.search_memories()` 接入 Rerank

### P1

1. Writing Skill 迁移到通用 `RerankerService`
2. 补前端最小可配置入口

### P2

1. 意图识别边界 case 接入 Rerank
2. harness 核心记忆通过协议注入接入

### P3

1. 已归档的独立 TypeScript 写作技能运行时侧接入

---

## 六、独立 TypeScript 写作技能运行时部分的修订

这部分方向可以保留，但要改两点表述。

### 6.1 可以独立实现 RerankerService

这个判断没问题。

### 6.2 不能假设它与 Python 共用同一套用户配置模型

这个判断在 v1.2 后半段其实已经意识到了，但前文仍写得太像“统一复用”。

更准确的说法应该是：

- **API 协议可以统一**
- **环境变量命名可以统一**
- **用户配置存储模型不能直接复用**

因此独立 TypeScript 运行时侧建议：

1. 第一版仅支持环境变量兜底
2. 第二版再根据它自己的 MongoDB 用户模型加用户级配置

这样更符合实际工程成本。

---

## 七、测试要求

## 7.1 必测项

### Writing Skill

- 用户配置 `writing_skill_rerank_model` 生效
- 用户未配置时环境变量兜底
- rerank 不可用时静默降级
- 不影响现有 invoke limit

### MemoryService

- overfetch 生效
- similarity threshold 后再 rerank
- rerank 失败保持原排序
- 用户无配置时功能仍正常

### 通用 RerankerService

- 配置优先级正确
- `/rerank` 请求 payload 正确
- 超时 / 4xx / 5xx 降级正确
- `async_rerank()` / `rerank_sync()` 行为一致

## 7.2 暂不要求

- harness 核心记忆端到端
- 意图识别全链路 A/B
- 独立 TypeScript 运行时自动化测试

这些都可以后置。

---

## 八、最终可执行版本的落地顺序

如果现在开始实施，建议严格按这个顺序：

1. **先不动前端**
2. 抽 `backend/app/gateway/services/reranker_service.py`
3. 给 `MemoryService.search_memories()` 加 overfetch + Rerank
4. 跑后端单测与本地真实接口验证
5. 再把 Writing Skill 私有 `_RerankBackend` 迁到通用服务
6. 最后再补最小前端配置入口

这个顺序的优点是：

- 风险最小
- 每一步都能独立验证
- 不会因为 UI 或跨层抽象卡住主价值链路

---

## 九、文档结论

**结论：这份方案现在可以执行，但必须按 v1.3 修订版执行，不能直接按 v1.2 原文落地。**

最核心的修改点有四个：

1. **前端配置部分降级为最小增量，不再假设简单设置页字段直加**
2. **同步包装改为显式 `rerank_sync()`，不采用线程池套 `asyncio.run()` 默认方案**
3. **MemoryService 接入前必须先做 overfetch**
4. **harness 核心记忆明确后置，不能直接 import `app.*`**

---

## 十、修订后的文件清单建议

### 第一批真实需要改的文件

- `backend/app/gateway/services/reranker_service.py`
- `backend/tests/test_reranker_service.py`
- `backend/app/gateway/novel_migrated/services/memory_service.py`
- `backend/tests/test_memory_rerank.py`

### 第二批再改

- `backend/packages/harness/deerflow/skills/writing_skill_index.py`
- `backend/tests/test_writing_skill_user_model_config.py`
- 前端最小配置入口相关文件

### 后置项

- `backend/app/gateway/middleware/intent_components.py`
- `backend/packages/harness/deerflow/agents/memory/prompt.py`
- 独立 TypeScript 写作技能运行时中的 `rerankerService.ts`

---

## 十一、是否建议立刻执行

建议，但只建议执行到：

- `RerankerService`
- `MemoryService`
- `Writing Skill 迁移`

这三步。

剩余部分不该在同一轮里一起推，否则复杂度会上升得太快，验证成本也不成比例。
