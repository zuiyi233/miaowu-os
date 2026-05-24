/**
 * About Miaowu OS markdown content. Inlined to avoid raw-loader dependency
 * (Turbopack cannot resolve raw-loader for .md imports).
 */
export const aboutMarkdown = `# 关于 Miaowu OS

> 面向小说作者的 AI 创作工作台

**Miaowu OS** 是围绕长篇小说创作流程构建的本地优先工作台。它把作品管理、作者控制台、场景计划、智能续写、证据化审校、可控修订、版本回滚和 Novel RAG 写回放在同一个作者闭环中，而不是只提供零散的 AI 调用按钮。

---

## 核心能力

* **小说工作室**：管理作品、章节、大纲、角色、关系、伏笔、世界设定和写作风格。
* **作者控制台**：从上下文预览、场景计划、生成候选、审校 issue 到版本 diff/回滚，形成可确认的创作闭环。
* **主运行时集成**：小说 AI 任务默认走 Miaowu OS 的 Gateway / RunManager / LangGraph 主运行路径，继承 skills、memory、thread isolation、日志与 token usage。
* **上下文边界**：作品剧情事实、章节正文、角色状态和伏笔进入 Novel RAG / workspace documents；用户长期偏好进入主 memory，避免互相污染。
* **本地开发契约**：本地后端固定使用 \`http://127.0.0.1:8551\`，前端使用 4560 或当前 Windows 可用端口，不把 8001 当默认本地地址。

---

## 开源基础

Miaowu OS 基于开源项目 **DeerFlow** 改造。DeerFlow 采用 MIT License，允许在遵守许可条款的前提下使用、修改和再分发。

原版官方仓库：[github.com/bytedance/deer-flow](https://github.com/bytedance/deer-flow)

---

## 致谢

感谢 DeerFlow、LangGraph、LangChain、Next.js、shadcn/ui 以及相关开源社区提供的基础能力。Miaowu OS 在此基础上继续面向中文长篇小说创作、作者控制台和本地部署体验做产品化改造。
`;
