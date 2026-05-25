import type { Translations } from "./types";

type NovelTranslations = Translations["novel"];
type NovelLocale = "en" | "zh";

const zhLabels: Partial<Record<keyof NovelTranslations, string>> = {
  ttsUnavailable: "未配置 TTS 服务",
  ttsUnavailableShort: "TTS 未配置",
  ttsPlay: "播放",
  ttsPause: "暂停",
  ttsGenerating: "生成语音中...",
  ttsStop: "停止",
  ttsProgress: "播放进度",
  ttsSettings: "语音设置",
  ttsSettingsPanel: "语音设置面板",
  ttsPlaybackEngine: "播放方式",
  ttsChoosePlaybackEngine: "选择播放方式",
  ttsDeviceReadAloud: "设备朗读",
  ttsAiAudiobook: "AI 有声书",
  ttsDeviceReadAloudHint: "使用手机或浏览器自带声音，不生成服务器音频。",
  ttsAiAudiobookHint: "使用服务端 API 生成可复用、可下载的章节音频。",
  ttsDeviceVoice: "设备声音",
  ttsDeviceVoiceUnavailable: "当前浏览器暂未返回可选声音。",
  ttsDeviceRate: "语速",
  ttsDevicePitch: "音调",
  ttsProvider: "服务商",
  ttsVoice: "声音",
  ttsChooseProvider: "选择 TTS 服务商",
  ttsChooseVoice: "选择声音",
  ttsCloseError: "关闭错误",
  ttsProviderOpenAI: "OpenAI",
  ttsProviderVolcengine: "火山引擎",
  ttsProviderMossLocal: "本地 MOSS",
  ttsConfigHint: "请先在配置中启用 TTS 服务。",
  ttsErrorPlayback: "播放失败",
  ttsErrorSynthesis: "语音合成失败",
  ttsErrorAutoplayBlocked: "浏览器阻止了自动播放",
  ttsErrorLoadConfig: "加载 TTS 配置失败",
  ttsErrorLoadVoices: "加载声音列表失败",
  ttsErrorMissingConfig: "TTS 服务尚未配置",
  ttsErrorInvalidRequest: "TTS 请求参数无效",
  ttsErrorUnsupportedProvider: "不支持当前 TTS 服务商",
  ttsErrorUnsupportedModel: "不支持当前语音模型",
  ttsErrorUnsupportedEndpoint: "当前服务商不支持语音合成接口",
  ttsErrorAuthFailed: "TTS 服务认证失败",
  ttsErrorRateLimited: "TTS 服务请求过于频繁",
  ttsErrorProviderTimeout: "TTS 服务响应超时",
  ttsErrorProviderFailed: "TTS 服务生成失败",
  ttsErrorStorageUnavailable: "语音存储暂不可用",
  ttsErrorQuotaExceeded: "TTS 配额已用尽",
  ttsErrorGenerationCancelled: "语音生成已取消",
  ttsChapterAudio: "章节音频",
  ttsCacheHit: "已复用",
  ttsCacheMiss: "需生成",
  ttsGenerateChapterAudio: "生成章节",
  ttsReuseChapterAudio: "复用章节",
  ttsRegenerateChapterAudio: "重生成",
  ttsDownloadAudio: "下载",
  ttsBrowserExportMp3: "本机导出",
  ttsBrowserExportHint: "在当前浏览器中加载 FFmpeg.wasm 合并 MP3 分片；手机上可能较慢。",
  ttsCancelJob: "取消",
  ttsRetryJob: "重试",
  ttsNarrationInstructions: "旁白指令",
  ttsNarrationInstructionsPlaceholder: "语气、情绪、节奏、口音或角色说明",
  ttsRoleVoices: "角色声音",
  ttsNarrationMode: "朗读模式",
  ttsChooseNarrationMode: "选择朗读模式",
  ttsSingleNarrator: "单旁白",
  ttsAiMultivoice: "AI 多角色",
  ttsNarrationPlan: "朗读计划",
  ttsNarrationPlanEmpty: "尚未加载朗读计划。",
  ttsLoadNarrationPlan: "加载计划",
  ttsGenerateNarrationPlan: "生成计划",
  ttsGenerateChapterWithPlan: "按计划生成",
  ttsUnsupportedHint: "灰色能力表示当前服务商暂不支持。",
  readingFocusMode: "专注阅读",
  readingTheme: "阅读主题",
  readingFontSize: "字号",
  readingLineHeight: "行高",
  readingParagraphSpacing: "段落间距",
  readingApplySettings: "应用设置",
  readingNoContent: "暂无正文内容",
  readingTableOfContents: "目录",
  readingPreviousChapter: "上一章",
  readingNextChapter: "下一章",
  routeLoadFailed: "页面加载失败",
  routeLoadFailedDescription: "请重试，或返回上一页后重新打开该小说。",
  retry: "重试",
};

const enLabels: Partial<Record<keyof NovelTranslations, string>> = {
  ttsUnavailable: "TTS service is not configured",
  ttsUnavailableShort: "TTS unavailable",
  ttsPlay: "Play",
  ttsPause: "Pause",
  ttsGenerating: "Generating speech...",
  ttsStop: "Stop",
  ttsProgress: "Playback progress",
  ttsSettings: "Voice settings",
  ttsSettingsPanel: "Voice settings panel",
  ttsPlaybackEngine: "Playback mode",
  ttsChoosePlaybackEngine: "Choose playback mode",
  ttsDeviceReadAloud: "Device read-aloud",
  ttsAiAudiobook: "AI audiobook",
  ttsDeviceReadAloudHint: "Use this device's built-in voices without generating server audio.",
  ttsAiAudiobookHint: "Generate reusable and downloadable chapter audio through server APIs.",
  ttsDeviceVoice: "Device voice",
  ttsDeviceVoiceUnavailable: "This browser has not returned selectable voices yet.",
  ttsDeviceRate: "Rate",
  ttsDevicePitch: "Pitch",
  ttsProvider: "Provider",
  ttsVoice: "Voice",
  ttsChooseProvider: "Choose TTS provider",
  ttsChooseVoice: "Choose voice",
  ttsCloseError: "Dismiss error",
  ttsProviderOpenAI: "OpenAI",
  ttsProviderVolcengine: "Volcengine",
  ttsProviderMossLocal: "Local MOSS",
  ttsConfigHint: "Enable a TTS provider in configuration first.",
  ttsErrorPlayback: "Playback failed",
  ttsErrorSynthesis: "Speech synthesis failed",
  ttsErrorAutoplayBlocked: "Autoplay was blocked by the browser",
  ttsErrorLoadConfig: "Failed to load TTS configuration",
  ttsErrorLoadVoices: "Failed to load voices",
  ttsErrorMissingConfig: "TTS service is not configured",
  ttsErrorInvalidRequest: "Invalid TTS request",
  ttsErrorUnsupportedProvider: "This TTS provider is not supported",
  ttsErrorUnsupportedModel: "This TTS model is not supported",
  ttsErrorUnsupportedEndpoint: "This provider does not support speech synthesis",
  ttsErrorAuthFailed: "TTS provider authentication failed",
  ttsErrorRateLimited: "TTS provider rate limit exceeded",
  ttsErrorProviderTimeout: "TTS provider timed out",
  ttsErrorProviderFailed: "TTS provider failed to generate speech",
  ttsErrorStorageUnavailable: "Speech storage is unavailable",
  ttsErrorQuotaExceeded: "TTS quota has been exceeded",
  ttsErrorGenerationCancelled: "Speech generation was cancelled",
  ttsChapterAudio: "Chapter audio",
  ttsCacheHit: "Reused",
  ttsCacheMiss: "Needs generation",
  ttsGenerateChapterAudio: "Generate chapter",
  ttsReuseChapterAudio: "Reuse chapter",
  ttsRegenerateChapterAudio: "Regenerate",
  ttsDownloadAudio: "Download",
  ttsBrowserExportMp3: "Local export",
  ttsBrowserExportHint: "Load FFmpeg.wasm in this browser to merge MP3 chunks; this may be slow on phones.",
  ttsCancelJob: "Cancel",
  ttsRetryJob: "Retry",
  ttsNarrationInstructions: "Narration instructions",
  ttsNarrationInstructionsPlaceholder: "Tone, emotion, pacing, accent, or character direction",
  ttsRoleVoices: "Role voices",
  ttsNarrationMode: "Narration mode",
  ttsChooseNarrationMode: "Choose narration mode",
  ttsSingleNarrator: "Single narrator",
  ttsAiMultivoice: "AI multivoice",
  ttsNarrationPlan: "Narration plan",
  ttsNarrationPlanEmpty: "No narration plan loaded.",
  ttsLoadNarrationPlan: "Load plan",
  ttsGenerateNarrationPlan: "Generate plan",
  ttsGenerateChapterWithPlan: "Generate with plan",
  ttsUnsupportedHint: "Disabled capabilities are unsupported by the selected provider.",
  readingFocusMode: "Focus reading",
  readingTheme: "Reading theme",
  readingFontSize: "Font size",
  readingLineHeight: "Line height",
  readingParagraphSpacing: "Paragraph spacing",
  readingApplySettings: "Apply settings",
  readingNoContent: "No chapter content",
  readingTableOfContents: "Table of contents",
  readingPreviousChapter: "Previous chapter",
  readingNextChapter: "Next chapter",
  routeLoadFailed: "Page failed to load",
  routeLoadFailedDescription: "Try again, or go back and reopen this novel.",
  retry: "Retry",
};

function labelFromKey(key: string, locale: NovelLocale): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();

  if (!label) {
    return key;
  }

  return locale === "zh"
    ? label
    : label.charAt(0).toUpperCase() + label.slice(1);
}

function functionFallback(key: keyof NovelTranslations, locale: NovelLocale) {
  if (key === "readingProgress") {
    return (percent: number) =>
      locale === "zh" ? `阅读进度 ${percent}%` : `Reading progress ${percent}%`;
  }

  if (key === "ttsPlanSummary") {
    return (speakers: number, segments: number) =>
      locale === "zh"
        ? `${speakers} 个说话人，${segments} 个片段`
        : `${speakers} speakers, ${segments} segments`;
  }

  if (key === "ttsPlanConfidence") {
    return (percent: number) =>
      locale === "zh" ? `置信度 ${percent}%` : `Confidence ${percent}%`;
  }

  if (key === "ttsLowConfidenceWarnings") {
    return (count: number) =>
      locale === "zh"
        ? `${count} 条低置信度提醒`
        : `${count} low-confidence warnings`;
  }

  return undefined;
}

export function withNovelDefaults(
  translations: Partial<NovelTranslations>,
  locale: NovelLocale,
): NovelTranslations {
  const labels = locale === "zh" ? zhLabels : enLabels;

  return new Proxy(translations as NovelTranslations, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined || typeof property !== "string") {
        return value;
      }

      const key = property as keyof NovelTranslations;
      return (
        functionFallback(key, locale) ??
        labels[key] ??
        labelFromKey(property, locale)
      );
    },
  });
}
