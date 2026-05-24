# miaowu-os 图片生成能力模块

## Goal

在 miaowu-os 中新增内置图片生成能力模块，复用 NewAPI/OpenAI-compatible 图片接口，先交付用户侧文生图 MVP。参考 `参考项目/gpt-image-playground-master` 的图片生成、参数兼容和任务详情思路，但不迁入其独立应用、管理后台、账号体系、额度审计、SQLite 或 Vite 子应用。

## User Value

- 用户可以在 miaowu-os 工作区内生成图片、查看历史、下载或复制图片 URL。
- 生成图片进入当前项目受控后端路径，不形成独立服务和数据孤岛。
- 后续可以自然扩展到图像编辑、参考图、小说封面/角色图/场景图。

## Requirements

- 后端新增轻量图片生成 API，第一阶段必须支持 `POST /api/v1/images/generate`、`GET /api/v1/images/jobs`、`GET /api/v1/images/jobs/{job_id}`、`GET /api/v1/images/files/{image_id}`。
- 文生图请求支持 `prompt`、`size`、`quality`、`n`、`model`、`aspect_ratio`，并调用 OpenAI-compatible `/images/generations`。
- 图片模型配置优先使用请求中的 `model`，否则使用后端默认图片模型配置；API key/base URL/分组/渠道/计费依靠 NewAPI 或现有配置，不在本模块自建。
- 生成输出必须保存到当前项目后端受控目录，并通过鉴权/访问控制接口读取。
- 必须记录最小任务历史：任务 ID、用户/主体标识、来源、操作、prompt、model、请求参数、响应元数据、状态、图片 URL、错误、耗时、创建/更新时间。
- 前端新增 `/workspace/images` 用户侧页面，支持 prompt、模型、尺寸/比例、质量、数量、提交生成、状态展示、历史、下载、复制 URL、查看错误。
- 第一阶段不实现图像编辑 UI，但后端/数据结构保留 `operation` 和参数边界，便于后续添加 `POST /api/v1/images/edit`。
- local-dev 约定继续使用前端 4560、后端 `http://127.0.0.1:8551`，不得引入 30116 或 8001 作为默认图片服务端口。

## Out of Scope

- 不做独立管理后台。
- 不做独立额度/审计系统。
- 不做独立账号、passphrase、owner、admin cookie。
- 不引入独立 SQLite。
- 不引入独立 Vite 子应用。
- 本轮不完整实现图像编辑、mask 编辑器和小说联动入口。
- 本轮不新增 NewAPI 渠道、分组、余额、额度管理。

## Acceptance Criteria

- [ ] `POST /api/v1/images/generate` 成功时返回任务 ID、状态、图片 URL、请求参数和耗时。
- [ ] 上游图片接口失败时任务状态为 `failed`，前端能看到可读错误。
- [ ] 空 prompt、非法 `n`、非法 `size` 返回明确 4xx。
- [ ] 生成图片文件可通过 `GET /api/v1/images/files/{image_id}` 读取。
- [ ] `/api/v1/images/jobs` 和 `/api/v1/images/jobs/{job_id}` 能返回当前主体可见的历史和详情。
- [ ] `/workspace/images` 可提交生成请求并展示成功/失败历史。
- [ ] 下载和复制 URL 可用，长 prompt、失败错误、大图缩略展示不破坏布局。
- [ ] 代码不依赖参考项目的 SQLite 表、admin cookie、passphrase owner 或独立端口。
- [ ] 完成可行的后端测试和前端类型/单测验证；无法验证的部分明确说明。
