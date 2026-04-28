# brainstorm: 小说工作室改为文件优先读取

## Goal
将当前“章节内容有时写入 outputs 文件但未进入小说工作室章节库”的链路统一，评估并落地“文件优先（官方 read/write 文件工具 + 工作室读取文本）”方案，确保角色/大纲/章节在同一可见工作流中稳定展示与可编辑。

## What I already know

- 用户确认现象：角色、大纲常能在工作室看到，但章节在部分会话中只生成 `chapter_*.md`，未正确进入工作室章节数据。
- 已看到工具端日志：模型在该轮走了 `/mnt/user-data/outputs` + `write_file` 路径。
- 代码现状：
  - `generate_characters` / `generate_outline` 走内部 API，直接落库。
  - `generate_chapter` 当前走 `batch_generate_chapters`，返回批任务（pending）并不等价于“正文已写入章节内容”。
  - 若模型直接调用 `write_file`，章节会落到 outputs 文件，不会自动同步到 chapters 表。

## Assumptions (temporary)

- 你希望显著降低复杂度，接受“章节内容以文本文件为主通道”，工作室读取并展示该文本。
- 角色、大纲等结构化实体暂时保留现有数据库能力（不强制全部文件化）。
- 本轮优先设计可落地 MVP，再考虑工具体系大规模重构。

## Open Questions

- 章节“真值源”是否改为文件（file-first）？还是保留数据库为真值源，仅增加文件同步层（db-first + file mirror）？

## Requirements (evolving)

- 章节内容必须在工作室稳定可见，不再出现“写了 chapter_x.md 但工作室无章节内容”的断层。
- 用户创作路径可简化，尽量复用官方文件工具。
- 对现有角色/大纲/世界观等功能影响最小。

## Acceptance Criteria (evolving)

- [ ] 输入“开始写第一章”后，工作室章节列表与章节正文可见。
- [ ] 章节编辑后，再次读取时内容一致（无双写冲突）。
- [ ] file-first 方案下，至少提供 1 条稳定导入/同步路径（文件 → 工作室显示）。

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- 一次性重写全部 16 个小说工具。
- 本轮不处理无关 UI 美化项。

## Technical Notes

- 已核查文件：
  - `backend/packages/harness/deerflow/tools/builtins/novel_creation_tools.py`
  - `backend/app/gateway/novel_migrated/api/chapters.py`
  - `backend/app/gateway/api/ai_provider.py`
- 关键现象：章节写文件与章节落库目前是两条并行通道，缺少统一真值与同步策略。
