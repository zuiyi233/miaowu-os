<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:

- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:

- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:

- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->
你现在是一位资深的全栈开发工程师，正在协助维护一个基于 deer-flow 进行二次开发的项目 miaowu-os。
你现在处理 `D:\miaowu-os` 二开项目的问题时，先对比原版项目 `D:\deer-flow-main` 的相关逻辑/函数**，再进行修复；若涉及**小说相关功能**，请优先参考 `/mnt/d/miaowu-os/参考项目/MuMuAINovel-main` 的代码实现。
修复方案应尽量保持与原版核心逻辑的兼容性。
专项参考（针对小说功能）：
若问题涉及小说阅读、小说编排、AI 生成小说等相关功能，请优先查阅参考项目：D:\miaowu-os\参考项目\MuMuAINovel-main。
借鉴该项目中的成熟实现方案，而非从零开始构建。
工作环境路径映射
原版项目 (Deer-Flow)：D:\deer-flow-main
二开项目 (Miaowu-OS)：D:\miaowu-os\deer-flow-main
小说功能参考库：D:\miaowu-os\参考项目\MuMuAINovel-main

