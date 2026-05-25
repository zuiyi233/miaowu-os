# 喵呜 OS 产品视频后续制作交接文档

本文档记录本轮制作喵呜 OS 产品介绍视频时得到的经验、当前视频工程状态、后续素材准备方式，以及下一轮继续制作时的推荐流程。

## 当前结论

当前视频已经从原本偏 30 秒容量的概念模板，调整为约 146 秒的竖屏 9:16 产品介绍视频。新版重点从“泛泛宣传”转为“长篇小说创作工作流说明”，覆盖了这些核心内容：

- 普通 AI 写中长篇小说的痛点：角色漂移、世界观冲突、伏笔遗忘、章节接不上、重复解释背景。
- 喵呜 OS 的定位：不是聊天机器人，而是面向长篇小说创作的 AI 项目工作台。
- 项目特有功能：角色管理、世界观沉淀、剧情线与章节状态、章节推进、章节分析、灵感模式、作者控制台。
- 核心价值：记得住、接得上、控得住。

当前可继续使用的工程目录：

```text
deer-flow-main/hyperframes/miaowu-product-video
```

当前主要文件：

```text
index.html                 HyperFrames 主视频工程
script.txt                 当前口播文案
caption-overrides.json     当前为空
assets/narration-raw.wav   MOSS-TTS-Nano 原始旁白
assets/narration.wav       提速并响度归一化后的旁白
renders/                   渲染结果和抽帧检查图
```

当前渲染过的主要视频：

```text
deer-flow-main/hyperframes/miaowu-product-video/renders/miaowu-product-video_2026-05-24_22-17-56.mp4
```

注意：这个版本已经可作为“内部预览版”，但如果要做正式宣传版，建议使用最终审核过的音频、字幕和产品截图重新对齐画面。

## 本轮踩到的问题

### 1. 画面和文案不匹配的根因

这不是单纯字幕时间轴的问题，而是视频结构问题。

如果先做一套泛用画面模板，再把长口播塞进去，就会出现：

- 画面还停留在痛点，旁白已经讲到产品功能。
- 画面展示角色管理，字幕却在讲世界观。
- 一个大镜头承载太多语义，观众感觉“文案和画面不是一回事”。

后续正确做法是先确定：

```text
旁白句子 -> 字幕块 -> 画面主题 -> 镜头时间
```

这四个东西必须来自同一张时间表。

### 2. 字幕不能按大段平均切

本轮已经把字幕从 18 条扩展到更细的短句字幕，但仍然发现一个问题：

```text
字幕必须尽量使用口播原句，而不是摘要改写。
```

如果字幕是摘要，观众会觉得嘴上说的和屏幕上的文字不一致。

后续正式版建议直接提供 `.srt` 字幕文件。这样可以避免我按估算时间切字幕。

### 3. 视频容量明显超过 30 秒

这个项目不是一个单点卖点产品。要讲清楚喵呜 OS，至少要覆盖：

- 痛点
- 产品定位
- 角色管理
- 世界观管理
- 大纲/章节推进
- AI 改写润色
- 章节分析
- 灵感模式
- 作者控制
- 开源/本地可控定位

30 秒只能做概念宣传，讲不清产品特色。比较合理的范围是：

```text
90-150 秒
```

如果素材足够，正式版做成 120 秒左右会更舒服。

## TTS 使用经验

### 1. 当前可用的本地 TTS

本机已测试可用：

```text
MOSS-TTS-Nano
http://localhost:18083
```

接口：

```text
POST http://localhost:18083/api/generate
```

当前实测可以用 CUDA，机器上有 RTX 3090。

### 2. 它支持多音色

MOSS-TTS-Nano 的音色来自参考音频。

项目里有预置 demo 列表：

```text
D:\MOSS-TTS-Nano\assets\demo.jsonl
```

这个文件的每一行是一个预置音色。服务启动后会自动编号：

```text
demo-1
demo-2
demo-3
...
```

注意：接口不认 `zh_1.wav` 这种文件名作为 `demo_id`。

本轮踩过一次坑：

```text
demo_id = zh_1
```

会报错：

```text
Unknown demo_id: zh_1
```

正确方式是：

```text
demo_id = demo-1
```

第一行就是 `demo-1`，第二行就是 `demo-2`，以此类推。

### 3. 它也支持上传参考音频

接口支持 `prompt_audio` 上传。

也就是说，后续可以不使用内置 demo 音色，而是上传你自己准备的参考音频，让它按这个声音生成。

建议参考音频：

```text
5-30 秒
单人声音
背景干净
不要有音乐
不要有多人说话
不要爆音
普通话口播最好用普通话参考音频
```

### 4. 本轮 TTS 生成结果

本轮新版文案用 MOSS-TTS-Nano 生成后：

```text
原始音频：159.76 秒
处理后音频：144.82 秒
```

处理方式：

```text
atempo=1.1033
loudnorm=I=-16:TP=-1.5:LRA=11
aresample=48000
```

原因：

- 原始音频语速偏慢。
- 当前视频时间轴设计为 146 秒。
- 轻微提速约 10% 后，听感仍可接受，且更贴近字幕时间轴。
- 使用 `loudnorm` 解决声音偏小问题，不建议只做简单增益。

## FFmpeg 经验

本机已经通过 winget 安装 FFmpeg，但当前 PowerShell 会话可能没有自动刷新 PATH。

实际安装路径：

```text
C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin
```

如果 HyperFrames 渲染时报：

```text
FFmpeg not found
```

不要重复安装，直接在当前命令前临时加 PATH：

```powershell
$env:PATH = 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin;' + $env:PATH
npm run render
```

音频检查可以用：

```powershell
$ffprobe = 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffprobe.exe'
& $ffprobe -hide_banner -show_entries format=duration,size -show_streams -of json renders\xxx.mp4
```

## HyperFrames 经验

### 1. 基本命令

在目录中执行：

```text
deer-flow-main/hyperframes/miaowu-product-video
```

检查：

```powershell
npm run check
```

渲染：

```powershell
npm run render
```

### 2. 检查结果说明

本轮 `npm run check` 经过修复后：

```text
lint: 0 errors, 0 warnings
validate: 0 errors, 0 warnings
inspect: 0 layout issues
```

但 HyperFrames 会反复报 WCAG AA contrast warnings，主要来自隐藏/透明元素或抽样时所有场景同时参与 contrast 检查。

这类 warning 不等于渲染失败。只要最终是：

```text
0 layout issues
```

并且抽帧视觉正常，就可以继续。

### 3. 水印大字容易溢出

本轮最先失败的是 `.watermark` 大字溢出画布。

修复方向：

- 不要用过大的英文水印字体。
- 给左右边界。
- 缩小字号。
- 避免 `overflow: hidden` 把文字自身裁掉。

当前做法：

```css
.watermark {
  left: 48px;
  right: 48px;
  font-size: 86px;
  line-height: 1;
  white-space: nowrap;
}
```

### 4. 入场动画也会触发溢出

如果元素从左侧滑入，HyperFrames 的 inspect 抽样可能正好抽到它还没完全进来的瞬间，从而报：

```text
text_box_overflow
canvas_overflow
```

本轮 `scene-6` 的流程卡片就出现过左侧 4px 溢出。

修复方式：

- 缩短动画时间。
- 提前入场。
- 减少初始位移。

例如：

```js
tl.fromTo(
  "#scene-6 .workflow-item",
  { x: -64, opacity: 0 },
  { x: 0, opacity: 1, duration: 0.36, stagger: 0.12, ease: "power3.out" },
  72.1
);
```

## 最推荐的下一步素材准备

如果要做正式版，请准备这些文件：

```text
voice.wav
subtitle.srt
script.txt
01-home.png
02-workspace.png
03-character-management.png
04-worldbuilding.png
05-outline.png
06-chapter-editor.png
07-ai-generate-panel.png
08-chapter-analysis.png
09-inspiration-mode.png
10-author-control-station.png
11-open-source-or-settings.png
```

其中最关键的是：

```text
voice.wav
subtitle.srt
产品截图
```

### 音频要求

推荐：

```text
wav
48kHz
单声道或双声道都可以
不要爆音
音量正常
```

也可以提供：

```text
mp3
m4a
aac
```

我可以转码。

### 字幕要求

最推荐 `.srt`：

```srt
1
00:00:00,400 --> 00:00:03,500
很多作者都试过用 AI 写小说。

2
00:00:03,600 --> 00:00:05,700
一开始，它很快。
```

如果没有时间轴，只有纯文本，我也可以做，但准确度会下降，需要重新估算或识别。

### 图片要求

优先给产品截图，而不是泛用氛围图。

推荐截图：

- 首页
- 创作工作台
- 角色管理
- 世界观管理
- 大纲
- 章节编辑器
- AI 生成面板
- 章节分析
- 灵感模式
- 作者控制台
- 设置页或开源项目页

命名建议：

```text
01-首页.png
02-创作工作台.png
03-角色管理.png
04-世界观管理.png
05-大纲.png
06-章节编辑器.png
07-AI生成面板.png
08-章节分析.png
09-灵感模式.png
10-作者控制台.png
```

如果图片里有隐私信息，请先打码，尤其是：

- API Key
- Token
- 用户邮箱
- 服务器地址
- 余额
- 内部域名
- 未公开配置

## 后续正式版制作流程

### 第一步：以最终音频为真源

不要先按想象写视频长度。

先确定：

```text
最终音频时长
```

然后用音频时长决定视频总长。

### 第二步：以 SRT 为字幕真源

字幕不再手工估算。

直接读取：

```text
subtitle.srt
```

然后把每条字幕转为 HyperFrames 里的 caption block。

### 第三步：以字幕段落重排画面

按字幕语义分组：

```text
痛点开场
痛点拆解
产品定位
角色管理
世界观管理
章节推进
章节分析/灵感模式
作者控制
价值总结
收尾 CTA
```

每组匹配对应截图和动态标题。

### 第四步：把产品截图放进功能段

后续正式版应该尽量减少纯文字卡片，多放真实产品图。

推荐画面策略：

- 痛点段：文字卡片 + 混乱写作状态的抽象画面。
- 产品定位：首页或项目工作台截图。
- 角色管理：角色页面截图。
- 世界观：世界观/组织/规则页面截图。
- 章节推进：大纲、章节编辑器、AI 面板。
- 分析/灵感：章节分析、灵感模式。
- 作者控制：作者控制台或项目仪表盘。
- 收尾：Logo、开源定位、产品截图拼贴。

### 第五步：重新渲染和抽帧核验

渲染后必须核验：

```text
1. 视频真实时长是否等于音频时长
2. 是否 1080x1920 竖屏
3. 是否有音频轨
4. 字幕是否可读
5. 字幕是否遮挡截图重点区域
6. 每个功能段画面是否与旁白匹配
7. 转场是否没有空白帧
```

抽帧建议时间：

```text
每个场景中段抽一帧
每个转场后 1 秒抽一帧
结尾 CTA 抽一帧
```

## 如果你要把任务交给我继续做

下一轮你只需要给我：

```text
最终音频
最终字幕 SRT
产品截图
```

然后我会做：

```text
1. 替换 assets/narration.wav
2. 读取真实音频时长
3. 解析 SRT
4. 按字幕时间轴生成 caption blocks
5. 按产品截图内容匹配画面段落
6. 调整 index.html 的场景和动画
7. npm run check
8. npm run render
9. FFprobe 验证视频
10. 抽帧生成 contact sheet
```

最终交付：

```text
MP4 视频
抽帧检查图
修改后的 index.html
使用到的音频和图片资源
```

## 当前建议

如果你现在还在让别人审核文案，不建议继续精修当前 TTS 版视频。

更推荐下一步先定稿：

```text
1. 口播文案
2. 音色
3. 最终音频
4. SRT 字幕
5. 产品截图
```

等这些确定后，再做正式版视频。这样可以避免重复改时间轴，也能彻底解决“画面、字幕、旁白对不上”的问题。
