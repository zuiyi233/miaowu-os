# miaowu-os 图片生成能力模块设计

## Architecture

新增图片生成能力作为 gateway 内部模块实现，使用现有 FastAPI 网关、现有前端 Next 应用和现有本地开发端口。参考项目只作为实现参考，不作为运行时依赖。

核心边界：

- API 层：`/api/v1/images/*` 路由处理请求校验、鉴权上下文、响应序列化。
- Service 层：封装图片模型调用、结果保存、任务状态记录。
- Storage 层：图片文件写入后端受控目录，数据库或轻量持久层只存元数据。
- Frontend：`/workspace/images` 页面通过现有 gateway client 调用 API。

## Data Flow

`Frontend form -> POST /api/v1/images/generate -> validate request -> resolve model config -> call OpenAI-compatible /images/generations -> persist image bytes -> record job metadata -> return job response -> frontend refreshes history/display`

失败流：

`upstream/config/storage error -> record failed job with readable error -> return response/error -> frontend displays failure in history/detail`

## API Contract

`POST /api/v1/images/generate`

- Request: `prompt`, `size?`, `aspect_ratio?`, `quality?`, `n?`, `model?`, `source?`
- Response: `id`, `status`, `operation`, `prompt`, `model`, `request_params`, `response_metadata`, `image_urls`, `error`, `elapsed_seconds`, `created_at`, `updated_at`

`GET /api/v1/images/jobs`

- Returns current user/session visible jobs ordered newest first.

`GET /api/v1/images/jobs/{job_id}`

- Returns a single visible job or 404.

`GET /api/v1/images/files/{image_id}`

- Returns the generated image file if the caller can access it.

## Storage and Compatibility

- Store generated files under a controlled backend data directory rather than the reference project's `generated/`, `jobs/`, `uploads/`, or `thumbnails` layout.
- Persist only task and image metadata; do not create a new account/owner model.
- Prefer the current authenticated user ID when available. If existing local-dev/test routes allow unauthenticated gateway calls, use a deterministic local subject only where existing auth helpers already permit it; do not add a new public passphrase scheme.
- Model base URL and API key should reuse existing OpenAI/NewAPI environment conventions where possible, with image-specific overrides only for default model/base URL if needed.
- Keep local-dev base URL assumptions aligned with `127.0.0.1:8551`.

## Future Boundaries

- `operation` supports future `edit`.
- Request metadata allows later `source=novel`, `novel_id`, `chapter_id`, `asset_role`.
- Frontend page can later add reference image upload and mask editor without changing the generate response shape.
