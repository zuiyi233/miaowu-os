# 用 MiMo 默认音色重制产品视频旁白

## Goal

使用 HyperFrames 的 media 能力生成 MiMo 默认音色旁白，替换此前喵呜 OS 竖屏产品介绍视频中的本地 MOSS-TTS-Nano 音频，并重新渲染可交付视频。

## Requirements

- 工作范围限制在 `deer-flow-main/hyperframes/miaowu-product-video` 及本任务文档。
- 以当前 `script.txt` 为口播文案真源，除非为了适配 MiMo 生成格式必须做最小处理。
- 使用 HyperFrames media/相关生成能力产出 MiMo 默认音色音频；若命令或环境不可用，必须记录具体阻塞点。
- 用新旁白替换视频音轨，必要时按新音频真实时长校准 `index.html` 的音频时长、视频总时长、场景和字幕时间轴。
- 保留或生成可追踪的输出文件，避免覆盖无法恢复的既有渲染产物。
- 重新运行 HyperFrames 检查和渲染，并抽帧验证画面/字幕/音频时间基本匹配。

## Acceptance Criteria

- [x] MiMo 默认音色旁白文件生成并放入 `assets/`。
- [x] `index.html` 引用新旁白，视频总时长与音频真实时长一致或合理收尾。
- [x] 字幕仍与 `script.txt` 口播句子对应，没有明显跨段错位。
- [x] 产出新的 MP4 渲染文件。
- [x] `npm run check` 通过，至少 lint/validate/inspect 无错误；如仅剩非阻塞 contrast warnings，要明确说明。
- [x] 使用 FFprobe 或等效方式核验最终视频为 1080x1920、9:16、30fps、有音频轨、真实时长正确。
- [x] 生成抽帧/contact sheet，确认关键段落非空白且字幕可读。

## Notes

- 当前仓库有多个 TTS/MiMo 业务代码任务的未提交改动，本任务不修改这些业务文件。
- 之前 MOSS-TTS-Nano 版本曾使用 `assets/narration.wav`，可改名保留备份或用新文件名引用，避免丢失对照。
