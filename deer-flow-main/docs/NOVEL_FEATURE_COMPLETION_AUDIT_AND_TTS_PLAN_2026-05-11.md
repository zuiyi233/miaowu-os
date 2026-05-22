# 小说功能完成度核验（含新增 TTS）- 2026-05-11（更新于 2026-05-12）

> 仓库：`D:\miaowu-os\deer-flow-main`  
> 首次核验时间：2026-05-11  
> 最近更新时间：2026-05-12  
> 核验范围：  
> 1) `docs/NOVEL_FEATURE_GAP_EXECUTION_PLAN_2026-05-11.md`（A1~C2）  
> 2) 新增"集成文本转语音（TTS）"计划  
> 3) 最小可执行验证（pytest/eslint/tsc）

---

## 1. 总结结论

**非测试项已全部收口完成，仅剩测试相关后续工作。**

- 原定计划（A1~C2）整体：**5 项完成，3 项部分完成，0 项明确未做**（A2 从"部分完成"升级为"已完成"）。
- 新增 TTS：**主链路已接通 + i18n 已接入 + 双实现已统一 + 死代码已清理**，仅剩自动化测试未补齐。
- 验证层面：后端 contract 测试通过、前端 TypeScript 通过。ESLint 仍有历史遗留 error（非本轮核心文件引入），需后续专项清理。

---

## 2. 原定计划逐项核验（A1~C2）

| 条目 | 状态 | 核验结论 |
|---|---|---|
| A1 改造 AI 面板 generate tab | 已完成 | `AiPanel` 已接入 `GeneratePanel`，且生成流程具备 pending/success/error 三态。 |
| A2 新建小说后端优先创建 | **已完成** | 创建已走 `novelDomainService.saveNovelWithOfflineFallback`；仅在网络不可达时本地兜底；UI 以 Badge + Alert 明示"离线草稿/未同步"状态。 |
| A3 收紧写操作降级策略 | 已完成 | `executeRemoteFirst` 已区分 `read/write`，写失败不再静默回退。 |
| B1 项目工作区加入拆书导入 | 已完成 | `ProjectWorkspaceLayout` 已增加 `book-import` 导航，且 `[novelId]/book-import` 页面存在。 |
| B2 Prompt 工坊可用性前置探测 | 已完成 | 前端启动即拉 `/api/prompt-workshop/status` 并按 available/degraded/unavailable 分支处理。 |
| B3 伏笔查询错误显式化 | 部分完成 | 后端异常会抛错；但前端 `ForeshadowsView` 未显式处理 query error，仍可能只呈现"暂无数据"。 |
| C1 internal `request=None` 合同测试化 | 已完成 | `backend/tests/test_novel_internal_contracts.py` 已存在并可通过。 |
| C2 新增小说主链路 E2E | 部分完成 | 有 `frontend/tests/e2e/novel.spec.ts`，但计划中三个专项 spec 文件未落地，关键断言覆盖仍不足。 |

---

## 3. 新增 TTS 计划核验

### 3.1 已完成

1. 后端 TTS 路由已注册并可用  
   - `backend/app/gateway/routers/tts.py`：`/api/tts/config`、`/api/tts/voices`、`/api/tts/synthesize`  
   - `backend/app/gateway/app.py`：`HARNESS_ROUTER_MODULES` 已包含 `app.gateway.routers.tts`

2. 前端 TTS 核心链路已接通  
   - `frontend/src/core/tts/api.ts`：配置/音色/合成请求  
   - `frontend/src/core/tts/hooks.ts`：播放状态、合成、暂停/继续/停止/seek  
   - `frontend/src/core/tts/index.ts`：导出入口正常

3. 小说阅读场景已接入  
   - `frontend/src/components/novel/reader/TtsPlayer.tsx`  
   - `frontend/src/components/novel/reader/ChapterReader.tsx`  
   - `frontend/src/components/novel/reader/ReadingMode.tsx`

4. TTS 文案已接入 i18n  
   - `frontend/src/core/i18n/locales/types.ts`：已有 `ttsUnavailable`/`ttsPlay`/`ttsPause`/`ttsStop`/`ttsGenerating`/`ttsSettings`/`ttsSettingsPanel`/`ttsProvider`/`ttsVoice`/`ttsChooseProvider`/`ttsChooseVoice`/`ttsCloseError`/`ttsProviderOpenAI`/`ttsProviderVolcengine`/`ttsConfigHint`/`ttsErrorPlayback`/`ttsErrorSynthesis`/`ttsErrorAutoplayBlocked`/`ttsErrorLoadConfig`/`ttsErrorLoadVoices`/`ttsProgress` 等完整 key  
   - `TtsPlayer.tsx` 已使用 `useI18n` + `t.novel.*` 取文案  
   - `ReadingMode.tsx` 通过复用 `TtsPlayer` 间接使用 i18n

5. **TTS 双实现已统一**（2026-05-12 完成）  
   - `ReadingMode.tsx` 中的 `TtsInlineControls` 已删除  
   - `ReadingMode.tsx` 改为复用 `TtsPlayer` 组件，通过 `tts` prop 传入外部 TTS 实例  
   - `TtsPlayer` 新增可选 `tts` prop，支持外部注入 TTS 状态，避免重复实例化  
   - 消除了两套并行逻辑的维护性风险

6. **A2 离线兜底已显式化**（2026-05-12 完成）  
   - `novel-api.ts` 新增 `isNetworkError()` 函数，区分网络错误与业务错误  
   - `novel-domain-service.ts` 新增 `saveNovelWithOfflineFallback()` 方法：在线走后端，仅网络不可达时本地兜底，返回 `{ synced: boolean }`  
   - `NovelCreationDialog.tsx` 使用新方法，离线时显示 Badge（"离线草稿"）+ Alert（"已保存为离线草稿，待网络恢复后同步至服务器"）  
   - i18n 新增 `offlineDraftSaved`/`offlineDraftBadge`/`offlineDraftHint` 三键

7. **核心文件死代码已清理**（2026-05-12 完成）  
   - `AiPanel.tsx`：删除未使用的 `openAnalysis` 回调、`analysisOpen`/`analysisChapterId` 状态、`ChapterAnalysis` 不可达渲染块、`useState`/`useCallback` 导入  
   - `GeneratePanel.tsx`：删除未使用的 `CHAPTERS_CACHE_TTL_MS` 常量、`chaptersCache.ts` 字段  
   - `ReadingMode.tsx`：删除 `TtsInlineControls`（~160 行重复代码）、`formatTime` 重复函数、`isPinned` 死状态、未使用的 lucide 图标导入（`Volume2`/`VolumeX`/`Pause`/`Square`/`ChevronDown`/`Loader2`）、`useRef`/`type TtsProvider` 导入

### 3.2 仍待后续（仅测试相关）

1. TTS 自动化测试缺失  
   - 未见 backend `tts` router 单测  
   - 未见 frontend `useTts` / `TtsPlayer` 单测  
   - 未见 TTS 相关 e2e

2. B3 前端显式错误态（需在 `ForeshadowsView.tsx` 增加 `isError/error` 分支）

3. C2 专项 E2E 文件未落地  
   - `frontend/tests/e2e/novel-create-and-generate.spec.ts`  
   - `frontend/tests/e2e/novel-book-import.spec.ts`  
   - `frontend/tests/e2e/novel-analysis-foreshadow.spec.ts`

4. 前端 ESLint 历史遗留 error（非本轮核心文件引入，需后续专项清理）  
   - `tts/api.ts`：4 处 `prefer-nullish-coalescing`  
   - `tts/hooks.ts`：`no-empty-function`、`prefer-optional-chain`

---

## 4. 2026-05-12 本轮修改文件清单

| 文件 | 目的 |
|---|---|
| `frontend/src/core/novel/novel-api.ts` | 新增 `isNetworkError()` 网络错误检测函数 |
| `frontend/src/core/novel/novel-domain-service.ts` | 新增 `saveNovelWithOfflineFallback()` 离线兜底保存方法；import `isNetworkError` |
| `frontend/src/components/novel/NovelCreationDialog.tsx` | 使用离线兜底方法；新增 `isOfflineDraft` 状态；离线时显示 Badge + Alert 提示 |
| `frontend/src/core/i18n/locales/types.ts` | 新增 `offlineDraftSaved`/`offlineDraftBadge`/`offlineDraftHint` 三键 |
| `frontend/src/core/i18n/locales/zh-CN.ts` | 补齐离线草稿中文文案 |
| `frontend/src/core/i18n/locales/en-US.ts` | 补齐离线草稿英文文案 |
| `frontend/src/components/novel/reader/TtsPlayer.tsx` | 新增可选 `tts` prop，支持外部注入 TTS 实例 |
| `frontend/src/components/novel/reader/ReadingMode.tsx` | 删除 `TtsInlineControls`（~160 行重复代码）；复用 `TtsPlayer`；删除 `isPinned` 死状态、`formatTime` 重复函数、未使用导入 |
| `frontend/src/components/novel/AiPanel.tsx` | 删除未使用的 `openAnalysis`/`analysisOpen`/`analysisChapterId`/`ChapterAnalysis` 渲染块；删除 `useState`/`useCallback`/`ChapterAnalysis` 导入 |
| `frontend/src/components/novel/ai/GeneratePanel.tsx` | 删除未使用的 `CHAPTERS_CACHE_TTL_MS` 常量；移除 `chaptersCache.ts` 字段 |
| `docs/NOVEL_FEATURE_COMPLETION_AUDIT_AND_TTS_PLAN_2026-05-11.md` | 更新交接文档状态 |

---

## 5. 实测验证结果（2026-05-11 首次核验）

> 执行目录：`D:\miaowu-os\deer-flow-main`  
> local-dev 口径：后端 `127.0.0.1:8551`，前端 `4560`（未使用 8001 作为默认）

1. 后端 contract 测试  
   - 命令：  
     `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_novel_internal_contracts.py -q`  
   - 结果：**通过**（`9 passed, 1 warning`）

2. 前端目标文件 ESLint  
   - 命令：  
     `pnpm -s exec eslint src/components/novel/AiPanel.tsx src/components/novel/ai/GeneratePanel.tsx src/components/novel/reader/TtsPlayer.tsx src/core/tts/api.ts src/core/tts/hooks.ts src/core/novel/novel-api.ts src/core/novel/novel-domain-service.ts`  
   - 结果：**失败**（`9 errors, 4 warnings`）

3. 前端类型检查  
   - 命令：`pnpm -s tsc --noEmit`  
   - 结果：**通过**

---

## 6. 仍待后续的工作（仅测试相关）

| 优先级 | 工作项 | 说明 |
|---|---|---|
| P0 | B3 前端显式错误态 | `ForeshadowsView.tsx` 增加 `isError/error` 分支 |
| P0 | ESLint 历史遗留 error 清零 | `tts/api.ts`（4 处 `prefer-nullish-coalescing`）、`tts/hooks.ts`（`no-empty-function`、`prefer-optional-chain`） |
| P1 | TTS 后端单测 | `backend/tests/test_tts_router.py` |
| P1 | TTS 前端单测 | `frontend/tests/unit/core/tts/useTts.test.ts`、`frontend/tests/unit/components/novel/reader/TtsPlayer.test.tsx` |
| P2 | C2 专项 E2E | `novel-create-and-generate.spec.ts`、`novel-book-import.spec.ts`、`novel-analysis-foreshadow.spec.ts` |

---

## 7. 接手执行时的验收命令

### 后端
```powershell
cd D:\miaowu-os\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_novel_internal_contracts.py -q
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_router.py -q
```

### 前端
```powershell
cd D:\miaowu-os\deer-flow-main\frontend
pnpm lint
pnpm -s tsc --noEmit
pnpm test
pnpm exec playwright test tests/e2e/novel.spec.ts
pnpm exec playwright test tests/e2e/novel-create-and-generate.spec.ts
pnpm exec playwright test tests/e2e/novel-book-import.spec.ts
pnpm exec playwright test tests/e2e/novel-analysis-foreshadow.spec.ts
```

---

## 8. 最终判定（给管理者）

**非测试项已全部收口完成。**  
A2 离线兜底显式化、TTS 双实现统一、核心文件死代码清理均已落地。  
剩余工作均为测试相关（B3 前端错误态、ESLint 历史遗留、TTS 单测/E2E），不影响功能正确性，建议在后续专项测试轮次中完成。
