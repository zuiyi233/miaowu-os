# 小说工作室全量文件真值 + 16 工具官方文件通道改造

## Goal

在 `D:\miaowu-os\deer-flow-main` 的小说工作室中，建立“文件为唯一真值源”的统一架构：每本书使用独立工作区目录承载正文与设定文档；数据库仅保留索引与运行态控制数据；16 款小说工具保持现有接口名但内部全部切到官方文件工具通道，彻底移除 DB 正文依赖与回退。

## What I already know

- 用户已明确采用**开发阶段直接重置数据库**策略，不做历史迁移与兼容桥接。
- 用户给定了工作区目录结构、`manifest.json` 字段、读写流程、API/前端字段、RAG 增量策略与 7 类测试用例。
- 项目约束：
  - 前端依赖仅 Win-only，禁止 WSL 操作前端依赖。
  - 二开仓库为 `D:\miaowu-os\deer-flow-main`；修复时需优先对比 `D:\deer-flow-main` 对应逻辑。
  - 小说功能优先参考 `D:\miaowu-os\参考项目\MuMuAINovel-main`。
  - local-dev 后端基址固定 `http://127.0.0.1:8551`（前端 4560），禁止默认 8001。

## Assumptions (temporary)

- 16 款小说工具当前已在后端存在稳定接口，前端调用方式不变，仅做后端内部重构。
- 可以接受一次性删除/废弃旧正文表字段与对应 ORM 读写代码。
- `manifest.json` 为项目级权威文档索引，DB 索引表为缓存，不参与真值仲裁。

## Open Questions

- 无阻塞问题：按用户给定方案直接执行。

## Requirements

1. 建立书籍工作区规范：`NOVEL_WORKSPACE_ROOT/{user_id}/{project_id}/`。
2. 固定目录结构覆盖：`book/chapters/outlines/characters/relationships/organizations/foreshadows/careers/memories/analysis/notes/history`。
3. `manifest.json` 至少包含：`entity_type/entity_id/path/title/content_hash/mtime/size/tags/schema_version`。
4. 所有写操作必须做路径安全校验：禁止 `../`、绝对路径、跨 `project_id`。
5. 16 款小说工具保留原接口名，内部统一为：
   - 生成/更新内容
   - 调用官方文件工具 (`read_file`/`write_file`/`list`/`replace` 等) 写入工作区
6. 删除工具内 DB 正文写入逻辑，删除 DB 正文回退读取。
7. 工具返回值统一为：`doc_path` + 索引状态（不再回传 DB 正文）。
8. 数据库重置并收敛为最小保留：
   - 文档索引缓存（`project_id/user_id/entity_type/entity_id/doc_path/content_hash/doc_updated_at/indexed_at/status`）
   - 运行态控制（任务状态、会话幂等、审计、权限等）
9. 读写链路约束：
   - 写：写文件 → 更新 manifest → 刷新索引
   - 读：列表走索引；详情直读文件；文件缺失明确报错，不回退 DB
10. 新增工作区维护接口：
    - `POST /api/novels/{project_id}/workspace/init`
    - `POST /api/novels/{project_id}/workspace/rescan`
11. API 返回体增加：`doc_path`、`content_source: "file"`、`content_hash`、`doc_updated_at`。
12. 提供文档直读/直写接口：
    - `GET /api/novels/{project_id}/documents/{entity_type}/{entity_id}`
    - `PUT /api/novels/{project_id}/documents/{entity_type}/{entity_id}`
13. 导入导出改为书籍文件夹打包模式。
14. RAG 仅绑定工作区文件，按 `content_hash/mtime` 增量重建，命名空间按 `project_id` 隔离。

## Acceptance Criteria

- [ ] 两本书并发创建与写入无跨项目串写。
- [ ] 章节/大纲/角色/关系/组织/伏笔/职业/记忆/分析/笔记在 UI 展示与文件内容一致。
- [ ] 手工改写文件后，`rescan` 能重建 manifest+索引并前端回显更新。
- [ ] 清空/禁用旧 DB 正文字段后，工作室可完整运行。
- [ ] 路径攻击（`../`、绝对路径、跨项目）全部被拒绝且有审计记录。
- [ ] RAG 增量仅重建变更文档对应切片。
- [ ] 批量生成、重试、分析等异步任务链路正常，结果正确落盘。

## Definition of Done

- 后端实现完成并通过可行范围内 lint/typecheck/test。
- 前端类型与 API 契约同步更新（若受影响）。
- 与 `D:\deer-flow-main` 核心逻辑兼容性评估完成；小说专项参考 `D:\miaowu-os\参考项目\MuMuAINovel-main` 对齐点有记录。
- 对无法在本轮完成/验证的项给出明确缺口与风险说明。

## Technical Approach

- 先构建文件真值基础设施（workspace manager + manifest + path guard + index model + init/rescan API）。
- 再按实体类型分批切工具实现，做到“接口不变、存储通道替换”。
- 最后统一改 API 响应、RAG 索引源、导入导出、测试与回归。

## Out of Scope

- 历史 DB 数据迁移与双写兼容。
- 首版之外的目录规范动态调整。
- 与本任务无关的 UI 视觉改版。

## Technical Notes

- 需要重点审查目录：
  - `backend/app/gateway/novel_migrated/api/`
  - `backend/app/gateway/novel_migrated/services/`
  - `backend/app/gateway/novel_migrated/models/`
  - `frontend/src/core/novel/`
- 本任务默认走 Windows 本地开发路径，前后端端口约束：后端 `8551`、前端 `4560`。
