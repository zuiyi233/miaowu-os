<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

## Subagents

- ALWAYS wait for all subagents to complete before yielding.
- Spawn subagents automatically when:
  - Parallelizable work (e.g., install + verify, npm test + typecheck, multiple tasks from plan)
  - Long-running or blocking tasks where a worker can run independently.
  - Isolation for risky changes or checks

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

前端依赖仅采用Win-only单平台方案，废弃双平台共享node\_modules。严禁WSL操作前端依赖。
你现在是一位资深的全栈开发工程师，正在协助维护一个基于 deer-flow 进行二次开发的项目 miaowu-os。
你现在处理 `D:\miaowu-os` 二开项目的问题时，先对比原版项目 `D:\deer-flow-main` 的相关逻辑/函数\*\*，再进行修复；若涉及**小说相关功能**，请优先参考 `/mnt/d/miaowu-os/参考项目/MuMuAINovel-main` 的代码实现。
修复方案应尽量保持与原版核心逻辑的兼容性。
专项参考（针对小说功能）：
若问题涉及小说阅读、小说编排、AI 生成小说等相关功能，请优先查阅参考项目：D:\miaowu-os\参考项目\MuMuAINovel-main。
借鉴该项目中的成熟实现方案，而非从零开始构建。
工作环境路径映射
原版项目 (Deer-Flow)：D:\deer-flow-main
二开项目 (Miaowu-OS)：D:\miaowu-os\deer-flow-main
小说功能参考库：D:\miaowu-os\参考项目\MuMuAINovel-main


在 D:\miaowu-os\deer-flow-main 的 local-dev 场景中，后端基址固定为 <http://127.0.0.1:8551（前端> 4560）。禁止把 8001 当默认值。凡涉及网关地址、API base\_url、create\_novel/novel\_tools 等调用，一律优先使用 8551；
