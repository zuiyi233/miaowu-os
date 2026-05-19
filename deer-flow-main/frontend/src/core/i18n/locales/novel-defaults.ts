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
  ttsProvider: "服务商",
  ttsVoice: "声音",
  ttsChooseProvider: "选择 TTS 服务商",
  ttsChooseVoice: "选择声音",
  ttsCloseError: "关闭错误",
  ttsProviderOpenAI: "OpenAI",
  ttsProviderVolcengine: "火山引擎",
  ttsConfigHint: "请先在配置中启用 TTS 服务。",
  ttsErrorPlayback: "播放失败",
  ttsErrorSynthesis: "语音合成失败",
  ttsErrorAutoplayBlocked: "浏览器阻止了自动播放",
  ttsErrorLoadConfig: "加载 TTS 配置失败",
  ttsErrorLoadVoices: "加载声音列表失败",
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
  ttsProvider: "Provider",
  ttsVoice: "Voice",
  ttsChooseProvider: "Choose TTS provider",
  ttsChooseVoice: "Choose voice",
  ttsCloseError: "Dismiss error",
  ttsProviderOpenAI: "OpenAI",
  ttsProviderVolcengine: "Volcengine",
  ttsConfigHint: "Enable a TTS provider in configuration first.",
  ttsErrorPlayback: "Playback failed",
  ttsErrorSynthesis: "Speech synthesis failed",
  ttsErrorAutoplayBlocked: "Autoplay was blocked by the browser",
  ttsErrorLoadConfig: "Failed to load TTS configuration",
  ttsErrorLoadVoices: "Failed to load voices",
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
