# 运行记录

## 2026-05-27

目标：用 MiMo 默认音色 `mimo-voice` 为 HyperFrames 竖屏产品视频重新生成旁白。

### 已确认

- HyperFrames 0.6.40 的本地 TTS 命令是 `hyperframes tts`，底层为 Kokoro-82M，不提供 MiMo 音色。
- 当前项目 MiMo 默认配置在后端代码中定义为：
  - model: `mimo-audio`
  - voice: `mimo-voice`
- 当前本机 8551、18083、3000 均未监听，不能直接复用运行中的 Miaowu 后端、MOSS demo 或本地 NewAPI。
- 当前环境变量和 `deer-flow-main/backend/.miaowu-local-newapi.env` 没有 `MIMO_TTS_BASE_URL` / `MIMO_TTS_API_KEY`。
- SQLite 用户设置里没有显式 MiMo / TTS feature routing；候选 NewAPI token 请求 `https://xg.miaowu.bond/v1/models` 均返回 401。
- 未配置 `SETTINGS_ENCRYPTION_KEY`，数据库内 encrypted token 不能可靠解密；不能把密文当作有效 token 使用。

### 已落地

- 新增 `deer-flow-main/hyperframes/miaowu-product-video/scripts/generate-mimo-narration.mjs`。
- 新增 npm 命令：

```powershell
npm run tts:mimo
```

脚本只读取当前 shell 环境变量，不保存密钥。默认输出：

```text
assets/narration-mimo-default.mp3
```

### 继续执行所需配置

在 `deer-flow-main/hyperframes/miaowu-product-video` 目录执行前，先设置：

```powershell
$env:MIMO_TTS_BASE_URL = "https://your-newapi-or-mimo-endpoint/v1"
$env:MIMO_TTS_API_KEY = "<your-key>"
$env:MIMO_TTS_MODEL = "mimo-audio"
$env:MIMO_TTS_VOICE = "mimo-voice"
npm run tts:mimo
```

如果服务端要求 Bearer 鉴权而不是 `api-key` header，需要调整脚本请求头。

### 验证结果

- `npm run tts:mimo`：按预期失败，错误为缺少 `MIMO_TTS_BASE_URL`。
- `npm run check`：通过。
  - lint: 0 errors, 0 warnings
  - validate: 0 errors, 0 warnings, 110 contrast warnings
  - inspect: 0 layout issues across 9 samples

### 当前阻塞

还没有真实可用的 MiMo TTS base URL 和 API key，因此不能生成 `mimo-voice` 音频，不能替换视频音轨，也不能重新渲染 MiMo 版本 MP4。

## 2026-05-27 补充完成

用户提供可用 NewAPI / MiMo 配置后，已写入视频工程本地文件：

```text
deer-flow-main/hyperframes/miaowu-product-video/.mimo-tts.local.env
```

该文件已加入同目录 `.gitignore`，避免误提交密钥。

### 生成与适配

- 远端模型：`mimo-v2.5-tts`
- 远端返回 `mimo-voice` 不可用，可用音色包含 `mimo_default`，因此本次使用 `mimo_default` 作为该服务暴露的 MiMo 默认音色。
- MiMo 原始输出：`assets/narration-mimo-default.mp3`
- 归一化渲染音轨：`assets/narration-mimo-default-normalized.wav`
- 归一化参数：FFmpeg `loudnorm=I=-16:TP=-1.5:LRA=11`
- 音频真实时长：156.16s
- `index.html` 已切换到归一化音轨，并按 144.8s -> 156.16s 比例拉伸场景、字幕和关键动画时间。

### 输出

最终视频：

```text
deer-flow-main/hyperframes/miaowu-product-video/renders/miaowu-product-video_2026-05-27_20-56-19.mp4
```

抽帧核验：

```text
deer-flow-main/hyperframes/miaowu-product-video/renders/verify-mimo-default/contact-sheet.jpg
```

### 验证结果

- `npm run tts:mimo`：成功生成 MiMo 音频。
- `npm run check`：通过。
  - lint: 0 errors, 0 warnings
  - validate: 0 errors, 0 warnings, 110 contrast warnings
  - inspect: 0 layout issues across 9 samples
- `npm run render`：成功。
- FFprobe 最终 MP4：
  - video: h264, 1080x1920, DAR 9:16, 30fps, duration 158.000000s
  - audio: aac, 48000 Hz, stereo, duration 158.016000s
  - format duration: 158.021029s
- Contact sheet 人工查看：关键段落非空白，字幕可读，画面主题与段落基本对齐。

## 2026-05-27 修复前 10 秒混入口播

问题：上一版 MiMo 请求把旁白风格指令和正式文案一起放进 `assistant.content`，TTS 模型会把风格指令也读出来，导致视频开头混入非产品宣传内容。

修复：

- `scripts/generate-mimo-narration.mjs` 已改为只把 `script.txt` 正文放入唯一的 `assistant` 消息。
- 该 TTS 模型不允许 `system` role，因此未再传入风格指令，避免任何非宣传文案被朗读。
- 重新生成 `assets/narration-mimo-default.mp3`。
- 重新生成归一化音轨 `assets/narration-mimo-default-normalized.wav`。
- 新音频真实时长为 143.84s，`index.html` 已重新校准到 145.5s 总时长。

额外安装：

- 已安装 whisper.cpp v1.8.4 到 `C:\Users\Administrator\.codex\tools\whisper.cpp\v1.8.4`。
- 已下载 whisper.cpp 模型 `ggml-base.bin` 到 `C:\Users\Administrator\.codex\tools\whisper.cpp\models\ggml-base.bin`。

前 12 秒转写核验：

```text
很多作者都試過用AI一些小說一開始它很快能給靈感能擴寫斷路也能幫你推進劇情但寫到中長篇問題就變了
```

转写存在繁简/少量识别误差，但内容只对应正式宣传文案开头，没有再出现“清晰、稳重、适合产品介绍视频”等非正文话术。

最终修正版视频：

```text
deer-flow-main/hyperframes/miaowu-product-video/renders/miaowu-product-video_2026-05-27_21-30-55.mp4
```

最终修正版抽帧：

```text
deer-flow-main/hyperframes/miaowu-product-video/renders/verify-mimo-clean/contact-sheet.jpg
```

修正版验证：

- `npm run check`：通过。
  - lint: 0 errors, 0 warnings
  - validate: 0 errors, 0 warnings, 110 contrast warnings
  - inspect: 0 layout issues across 9 samples
- `npm run render`：成功。
- FFprobe 最终 MP4：
  - video: h264, 1080x1920, DAR 9:16, 30fps, duration 145.500000s
  - audio: aac, 48000 Hz, stereo, duration 145.514667s
  - format duration: 145.521029s
- Contact sheet 人工查看：关键段落非空白，字幕可读，画面主题与段落基本对齐。
