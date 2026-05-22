# API请求缓存复用优化 - A+B+C混合方案实现

## Goal

解决当前API请求每次完整传输100k+ tokens上下文的问题，通过并行实施A（修复消息格式）+ B（应用层缓存中间件）+ C（配置层启用缓存）的混合方案，激活项目中已有的Claude Prompt Caching机制和OpenAI Prefix Caching功能，预期实现：
- 缓存命中率提升至60-80%
- 成本降低50-90%（Claude 90%折扣，OpenAI 50%折扣）
- 延迟降低50-80%

## Requirements

### Phase 1: 方案A - 修复消息格式传递链路（核心基础）

#### A1. 修改ai_provider.py的chat_endpoint (P0)
**文件**: [backend/app/gateway/api/ai_provider.py:142-188](file:///D:\miaowu-os\deer-flow-main\backend\app\gateway\api\ai_provider.py#L142-L188)
- [ ] 接收`body.messages`数组并直接传递（不再调用`_build_prompt_from_messages()`）
- [ ] 流式请求调用新的`_stream_generator_with_messages(ai_service, body.messages, body.provider_config)`
- [ ] 非流式请求调用新的`ai_service.generate_text_with_messages(messages=body.messages, ...)`
- [ ] 保留旧方法标记为`@deprecated`，添加环境变量开关`USE_MESSAGES_FORMAT`

#### A2. 新增_stream_generator_with_messages (P0)
**文件**: `backend/app/gateway/api/ai_provider.py`
- [ ] 签名: `async def _stream_generator_with_messages(ai_service, messages: list[AiMessage], config: AiProviderConfig)`
- [ ] 调用`ai_service.generate_text_stream_with_messages(messages=messages, ...)`
- [ ] 保持SSE格式输出不变

#### A3. 扩展ai_service.py (P0)
**文件**: [backend/app/gateway/novel_migrated/services/ai_service.py](file:///D:\miaowu-os\deer-flow-main\backend\app\gateway\novel_migrated\services\ai_service.py#L93-L180)

**A3.1 新增消息转换方法**
```python
def _build_messages_from_array(self, messages: list[AiMessage]) -> list[Any]:
    """将AiMessage[]转换为LangChain消息列表"""
```
- [ ] 映射规则: system→SystemMessage, user→HumanMessage, assistant→AIMessage
- [ ] 保持原始content不修改

**A3.2 新增非流式方法**
```python
async def generate_text_with_messages(
    self, messages: list[AiMessage], model, temperature, max_tokens, ...
) -> dict[str, Any]:
```
- [ ] 复用现有MCP工具准备逻辑（`_prepare_mcp_tools()`）
- [ ] 调用`_build_messages_from_array(messages)`构建langchain_messages
- [ ] 调用`llm.ainvoke(langchain_messages, config={...})`
- [ ] 返回格式与`generate_text()`完全兼容

**A3.3 新增流式方法**
```python
async def generate_text_stream_with_messages(
    self, messages: list[AiMessage], model, temperature, max_tokens, ...
) -> AsyncGenerator[str, None]:
```
- [ ] 复用MCP工具逻辑
- [ ] 调用`llm.astream(langchain_messages, config={...})`
- [ ] 返回类型与`generate_text_stream()`一致

#### A4. 单元测试 (P0)
**文件**: `tests/test_ai_service_messages.py` (新建)
- [ ] 测试`_build_messages_from_array()`的消息类型映射正确性
- [ ] 测试空messages列表处理
- [ ] 测试包含system/user/assistant混合角色的转换
- [ ] 测试`generate_text_with_messages()`的mock调用
- [ ] 测试向后兼容性（旧方法仍可用）

### Phase 2: 方案B - 应用层内存缓存中间件（性能加速）

#### B1. 创建PromptCacheMiddleware类 (P1)
**文件**: `backend/app/gateway/middleware/prompt_cache.py` (新建)

**B1.1 核心数据结构**
```python
class PromptCacheMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, ttl: int = 300, max_entries: int = 1000):
        self._cache: dict[str, CacheEntry] = {}  # 内存字典
        self.ttl = ttl
        self.max_entries = max_entries
        self._stats = {"hits": 0, "misses": 0}
```
- [ ] 使用内存字典存储（零外部依赖）
- [ ] LRU淘汰策略（达到max_entries时淘汰最老条目）
- [ ] TTL自动过期检查

**B1.2 缓存键生成**
```python
def _compute_cache_key(self, data: dict) -> str:
    """基于messages + model + temperature生成SHA256 hash"""
```
- [ ] 规范化JSON（sort_keys=True, ensure_ascii=False）
- [ ] 固定temperature精度到小数点后2位
- [ ] 返回格式: `prompt_cache:{sha256_hash}`

**B1.3 中间件dispatch逻辑**
```python
async def dispatch(self, request: Request, call_next):
    # 仅拦截 POST /api/ai/chat
    # 1. 读取request body
    # 2. 计算cache_key
    # 3. 查询缓存 → 命中则直接返回
    # 4. miss → 调用call_next(request)
    # 5. 缓存响应结果（仅200状态码）
```
- [ ] 仅拦截POST `/api/ai/chat`路径
- [ ] 支持环境变量`ENABLE_PROMPT_CACHE=true/false`控制开关
- [ ] 异常时自动降级（绕过缓存）

**B1.4 缓存统计端点**
- [ ] 提供`get_stats()`方法返回hits/misses/hit_rate
- [ ] 可选：注册FastAPI路由`/api/ai/cache-stats`查看实时统计

#### B2. 集成到FastAPI应用 (P1)
**文件**: `backend/app/gateway/app.py`
- [ ] 导入PromptCacheMiddleware
- [ ] 添加middleware:
  ```python
  app.add_middleware(
      PromptCacheMiddleware,
      ttl=int(os.getenv("PROMPT_CACHE_TTL", "300")),
      max_entries=int(os.getenv("PROMPT_CACHE_MAX_ENTRIES", "1000")),
  )
  ```
- [ ] 确保middleware在路由注册之后添加

#### B3. 单元测试 (P1)
**文件**: `tests/test_prompt_cache_middleware.py` (新建)
- [ ] 测试缓存键生成一致性（相同输入→相同key）
- [ ] 测试缓存键唯一性（不同输入→不同key）
- [ ] 测试缓存命中场景（第二次请求返回缓存结果）
- [ ] 测试缓存miss场景（首次请求调用后端）
- [ ] 测试TTL过期机制
- [ ] 测试LRU淘汰策略
- [ ] 测试异常降级（缓存故障时绕过）

### Phase 3: 方案C - 配置层启用Claude缓存（配置激活）

#### C1. 修改模型配置文件 (P1)
**文件**: `config.yaml` (或对应的模型配置文件)
- [ ] 定位Claude模型配置段
- [ ] 添加/确认以下配置:
  ```yaml
  models:
    - name: claude-sonnet-4
      use: deerflow.models.claude_provider:ClaudeChatModel  # 使用内置缓存Provider
      model: claude-sonnet-4-20250514
      enable_prompt_caching: true       # 明确启用（默认已为true）
      prompt_cache_size: 3              # 缓存最近3条消息
  ```

#### C2. 工厂方法增强（可选优化）(P2)
**文件**: [backend/packages/harness/deerflow/models/factory.py:91-192](file:///D:\miaowu-os\deer-flow-main\backend\packages\harness\deerflow\models\factory.py#L91-L192)
- [ ] 在`create_chat_model()`中检测`enable_prompt_caching`参数
- [ ] 将参数传递给ClaudeChatModel实例
- [ ] 从config.yaml读取配置时自动注入

#### C3. 验证测试 (P1)
**文件**: `tests/test_claude_caching_config.py` (新建)
- [ ] 测试ClaudeChatModel实例化时enable_prompt_caching=True
- [ ] 测试_apply_prompt_caching()正确标记system消息
- [ ] 测试cache_control: {type: "ephemeral"}被添加
- [ ] 测试最近N条消息被标记缓存

## Acceptance Criteria

### 功能验收标准
- [ ] **AC1**: 前端发送的多轮对话messages数组能完整传递到LLM Provider（不丢失结构）
- [ ] **AC2**: Claude模型的请求自动添加`cache_control: {type: "ephemeral"}`标记到system和最近消息
- [ ] **AC3**: OpenAI/GPT系列请求前缀一致时延迟降低≥50%
- [ ] **AC4**: 相同请求在TTL内直接返回缓存结果（延迟<10ms）
- [ ] **AC5**: 缓存命中率监控指标可通过日志或API查询
- [ ] **AC6**: 旧API接口（基于字符串prompt）仍可正常工作（向后兼容）

### 性能验收标准
- [ ] **PERF1**: P95延迟 < 3秒（优化后）
- [ ] **PERF2**: 缓存命中率 ≥ 70%（稳定system prompt场景）
- [ ] **PERF3**: Token成本节省 ≥ 50%（对比基线测量）
- [ ] **PERF4**: 中间件开销 < 5ms（缓存miss路径）

### 兼容性验收标准
- [ ] **COMPAT1**: 现有前端代码无需任何修改
- [ ] **COMPAT2**: 所有现有单元测试通过（无回归）
- [ ] **COMPAT3**: 流式SSE输出格式保持不变
- [ ] **COMPAT4**: 错误响应格式保持不变

## Definition of Done

- [ ] 所有新增代码通过lint检查（ruff）
- [ ] 所有新增代码通过typecheck（mypy或pyright）
- [ ] 单元测试覆盖率 ≥ 80%（新增代码部分）
- [ ] 集成测试通过（使用mock LLM Provider或真实Provider验证）
- [ ] 回滚策略就绪：
  - 环境变量`USE_MESSAGES_FORMAT=0`切换回旧逻辑
  - 环境变量`ENABLE_PROMPT_CACHE=false`禁用缓存中间件
  - 旧方法保留至少3个月
- [ ] Code Review通过（至少1人approve）

## Technical Approach

### 架构设计（三层缓存）

```
┌─────────────────────────────────────────────────────────────┐
│  L1: 应用层内存缓存（方案B）                                  │
│  · 精确匹配：相同请求hash → 直接返回                         │
│  · TTL: 300秒（可配置）                                      │
│  · 存储: dict + LRU淘汰                                     │
└─────────────────────┬───────────────────────────────────────┘
                      │ miss
┌─────────────────────▼───────────────────────────────────────┐
│  L2: Provider原生缓存（方案A+C激活）                          │
│  · Claude: cache_control ephemeral（90%折扣）               │
│  · OpenAI: automatic prefix caching（50%折扣）              │
│  · TTL: 5分钟-1小时（由provider管理）                        │
└─────────────────────┬───────────────────────────────────────┘
                      │ miss
┌─────────────────────▼───────────────────────────────────────┐
│  L3: 上游LLM Provider实际计算                                │
│  · OpenAI/Claude/Gemini等                                   │
└─────────────────────────────────────────────────────────────┘
```

### 数据流修复前后对比

**修复前（当前状态）**:
```
前端 messages[] → ai_provider.py → _build_prompt_from_messages() → 字符串
                                                          ↓
                                              ai_service._build_messages() → 单轮对话
                                                          ↓
                                              LLM Provider（无法识别缓存前缀）
```

**修复后（目标状态）**:
```
前端 messages[] → ai_provider.py → 直接传递messages[]
                          ↓
              ai_service._build_messages_from_array() → 完整多轮对话
                          ↓
              LLM Provider（✅ 前缀一致触发缓存）
                          ↑
          PromptCacheMiddleware（✅ 精确匹配命中则短路）
```

### 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 缓存存储 | **内存字典** | 零依赖，单机足够，避免Redis运维复杂度 |
| TTL策略 | **统一300秒** | 初期简化，后续可根据业务分层 |
| 向后兼容 | **环境变量开关** | USE_MESSAGES_FORMAT + ENABLE_PROMPT_CACHE |
| 淘汰策略 | **LRU（最大1000条）** | 平衡内存占用与命中率 |
| 并行实施 | **一次性完成A+B+C** | 减少集成风险，统一测试验证 |

## Decision (ADR-lite)

**Context**: 当前系统每次API请求传输100k+ tokens全量上下文，未利用已有的缓存机制。文档提出三个独立方案（A/B/C），需选择最优组合。

**Decision**: 采用**A+B+C并行实施的混合方案**
- 方案A作为**基础**（修复数据格式，激活Provider原生缓存）
- 方案B作为**加速器**（应用层精确匹配缓存，进一步降低延迟）
- 方案C作为**配置保障**（确保Claude缓存配置正确启用）

**Consequences**:
- ✅ **收益最大化**: 三层缓存协同工作，预期成本降低50-90%，延迟降低50-80%
- ✅ **一步到位**: 避免多次部署的集成风险
- ⚠️ **工作量较大**: 预计3-5天完成（vs 分阶段7-10天）
- ⚠️ **测试复杂度增加**: 需同时验证三层缓存的交互
- 🔄 **回滚策略必要**: 必须提供环境变量开关确保可快速回退

## Out of Scope

- ❌ **语义缓存**（Embedding相似度匹配）：Phase 2暂不实现
- ❌ **分布式缓存**（多实例共享Redis）：单机内存满足需求
- ❌ **缓存预热机制**：依赖自然请求填充
- ❌ **前端改动**：前端已正确传递数据
- ❌ **Grafana/Prometheus深度集成**：初期采用日志统计
- ❌ **自定义缓存协议**：仅利用Provider原生能力

## Technical Notes

### 关键文件清单与修改类型
| 文件路径 | 操作 | 所属阶段 | 说明 |
|----------|------|---------|------|
| `backend/app/gateway/api/ai_provider.py` | **修改** | A | chat_endpoint、_stream_generator重构 |
| `backend/app/gateway/novel_migrated/services/ai_service.py` | **修改** | A | 新增3个方法 |
| `backend/app/gateway/middleware/prompt_cache.py` | **新建** | B | 缓存中间件实现 |
| `backend/app/gateway/app.py` | **修改** | B | 注册middleware |
| `config.yaml` | **修改** | C | 启用Claude缓存配置 |
| `backend/packages/harness/deerflow/models/factory.py` | **可选修改** | C | 工厂方法增强 |
| `tests/test_ai_service_messages.py` | **新建** | A | AI Service单元测试 |
| `tests/test_prompt_cache_middleware.py` | **新建** | B | 缓存中间件测试 |
| `tests/test_claude_caching_config.py` | **新建** | C | 配置验证测试 |

### 技术约束
1. **LangChain消息类型**: 必须使用`SystemMessage`, `HumanMessage`, `AIMessage`
2. **FastAPI中间件**: 继承`BaseHTTPMiddleware`，注意async dispatch的执行顺序
3. **SSE流式格式**: 必须保持`data: {...}\n\n`和`data: [DONE]\n\n`
4. **向后兼容**: 旧方法保留≥3个月，提供环境变量开关
5. **线程安全**: 内存缓存需考虑并发访问（asyncio单线程通常安全）

### 参考资源
- 分析报告: [API请求缓存复用问题分析报告.md](file:///d:\miaowu-os\docs\API请求缓存复用问题分析报告.md)
- Claude缓存实现: [claude_provider.py:192-233](file:///D:\miaowu-os\deer-flow-main\backend\packages\harness\deerflow\models\claude_provider.py#L192-L233)
- 前端请求构建: [global-ai-service.ts:324-429](file:///D:\miaowu-os\deer-flow-main\frontend\src\core\ai\global-ai-service.ts#L324-L429)
- 原版项目对照: `D:\deer-flow-main`（需对比验证兼容性）

### 环境变量清单
| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `USE_MESSAGES_FORMAT` | `1` | `1`=使用新messages数组格式，`0`=回退到旧字符串格式 |
| `ENABLE_PROMPT_CACHE` | `true` | 是否启用应用层缓存中间件 |
| `PROMPT_CACHE_TTL` | `300` | 缓存TTL（秒） |
| `PROMPT_CACHE_MAX_ENTRIES` | `1000` | 最大缓存条目数 |

---

## Implementation Plan (详细任务分解)

### PR1: 基础架构改造（方案A核心）- 预计2天

**Task A1-A2: API层重构**
- [ ] 修改`ai_provider.py`的`chat_endpoint()`
  - 添加环境变量检查`os.getenv("USE_MESSAGES_FORMAT", "1") != "0"`
  - 新分支：传递`body.messages`到新方法
  - 旧分支：保留原有`_build_prompt_from_messages()`逻辑
- [ ] 新增`_stream_generator_with_messages()`
  - 参数改为接收`messages: list[AiMessage]`
  - 内部调用`generate_text_stream_with_messages()`

**Task A3: AIService层扩展**
- [ ] 实现`_build_messages_from_array()`
  - 类型映射逻辑
  - 边界情况处理（空列表、未知role）
- [ ] 实现`generate_text_with_messages()`
  - 复用MCP工具准备逻辑
  - 调用链: messages → langchain_messages → llm.ainvoke()
  - 返回值格式化
- [ ] 实现`generate_text_stream_with_messages()`
  - 异步生成器实现
  - chunk解析逻辑（与现有`generate_text_stream()`一致）

**Task A4: 单元测试编写**
- [ ] 消息转换测试套件
- [ ] Mock LLM Provider集成测试
- [ ] 向后兼容性验证测试

### PR2: 缓存中间件实现（方案B）- 预计2天

**Task B1-B2: Middleware核心**
- [ ] 实现`PromptCacheMiddleware`类
  - 内存缓存数据结构
  - TTL管理逻辑
  - LRU淘汰算法
- [ ] 实现`_compute_cache_key()`
  - 规范化JSON序列化
  - SHA256哈希生成
- [ ] 实现`dispatch()`方法
  - 请求拦截逻辑
  - 缓存查询/存储流程
  - 异常降级处理
- [ ] 集成到FastAPI app
  - middleware注册顺序
  - 环境变量读取

**Task B3: 监控与测试**
- [ ] 实现缓存统计接口
- [ ] 编写完整的中间件测试套件
  - 命中/miss/TTL/淘汰全覆盖

### PR3: 配置优化与集成验证（方案C+集成）- 预计1天

**Task C1-C3: 配置与工厂增强**
- [ ] 修改`config.yaml`启用Claude缓存
- [ ] （可选）增强`factory.py`支持缓存参数
- [ ] 编写配置验证测试

**Task INT: 集成测试与回归验证**
- [ ] 端到端集成测试（前端→API→LLM Provider完整链路）
- [ ] 三层缓存交互验证
  - L1命中 → 直接返回
  - L1 miss → L2命中 → Provider缓存生效
  - L1+L2 miss → 全量计算
- [ ] 性能基准测试
  - 延迟对比（优化前 vs 优化后）
  - 缓存命中率统计
- [ ] 回归测试
  - 所有现有测试通过
  - 流式/非流式/错误场景全覆盖
- [ ] 文档更新
  - README补充缓存配置说明
  - CHANGELOG记录变更

### 风险控制与回滚策略

**紧急回滚操作**（如上线后发现严重问题）：
```bash
# 1. 禁用新消息格式（回退到字符串模式）
set USE_MESSAGES_FORMAT=0

# 2. 禁用缓存中间件
set ENABLE_PROMPT_CACHE=false

# 3. 重启服务
# 系统将恢复到优化前的行为
```

**渐进式灰度发布建议**（可选）：
1. 先在开发环境完整验证（1天）
2. 预发布环境观察24小时
3. 生产环境10%流量灰度（1-2天）
4. 全量发布

---

**计划制定日期**: 2026-04-19
**预计总工期**: 5个工作日（并行实施）
**下一步行动**: 用户确认此计划后，立即开始PR1实施
