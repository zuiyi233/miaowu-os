import { describe, expect, it, vi } from 'vitest';

import { zhCN } from '@/core/i18n/locales/zh-CN';

const useI18nMock = vi.fn(() => ({ t: zhCN }));
const useTtsMock = vi.fn(() => ({
  playing: false,
  loading: false,
  error: null,
  errorCode: null,
  progress: 0,
  duration: 0,
  currentTime: 0,
  status: null,
  smoke: null,
  providerError: null,
  chapterAudio: null,
  chapterLoading: false,
  chapterGenerating: false,
  chapterJob: null,
  chapterCacheState: 'unknown',
  downloadUrl: null,
  config: {
    providers: {
      openai: { available: false },
      volcengine: { available: false },
      'moss-local': { available: false },
    },
  },
  voices: [],
  selectedProvider: 'openai',
  selectedVoice: undefined,
  selectedModel: undefined,
  selectedFormat: undefined,
  selectedSpeed: undefined,
  instructions: undefined,
  advancedOptions: undefined,
  narrationMode: 'single_narrator',
  narrationPlan: null,
  narrationPlanLoading: false,
  narrationPlanGenerating: false,
  speakerVoices: {},
  capabilities: null,
  setSelectedProvider: vi.fn(),
  setSelectedVoice: vi.fn(),
  setSelectedModel: vi.fn(),
  setSelectedFormat: vi.fn(),
  setSelectedSpeed: vi.fn(),
  setInstructions: vi.fn(),
  setAdvancedOptions: vi.fn(),
  setNarrationMode: vi.fn(),
  setSpeakerVoices: vi.fn(),
  loadNarrationPlan: vi.fn(),
  generatePlan: vi.fn(),
  savePlan: vi.fn(),
  speak: vi.fn(),
  loadChapterAudio: vi.fn(),
  generateChapter: vi.fn(),
  cancelChapterJob: vi.fn(),
  retryChapterJob: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock('@/core/i18n/hooks', () => ({
  useI18n: () => useI18nMock(),
}));

vi.mock('@/core/tts', () => ({
  useTts: () => useTtsMock(),
}));

describe('TtsPlayer i18n wiring', () => {
  it('exposes expected i18n labels for unavailable state', () => {
    expect(zhCN.novel.ttsUnavailable).toBe('未配置 TTS 服务');
    expect(zhCN.novel.ttsUnavailableShort).toBe('TTS 未配置');
    expect(zhCN.novel.ttsSettings).toBe('语音设置');
    expect(zhCN.novel.ttsChooseProvider).toBe('选择 TTS 服务商');
  });

  it('exposes i18n labels for moss-local and stable backend error codes', () => {
    expect(zhCN.novel.ttsProviderMossLocal).toBe('本地 MOSS');
    expect(zhCN.novel.ttsErrorMissingConfig).toBe('TTS 服务尚未配置');
    expect(zhCN.novel.ttsErrorInvalidRequest).toBe('TTS 请求参数无效');
    expect(zhCN.novel.ttsErrorUnsupportedEndpoint).toBe('当前服务商不支持语音合成接口');
    expect(zhCN.novel.ttsErrorAuthFailed).toBe('TTS 服务认证失败');
    expect(zhCN.novel.ttsErrorRateLimited).toBe('TTS 服务请求过于频繁');
    expect(zhCN.novel.ttsErrorProviderTimeout).toBe('TTS 服务响应超时');
    expect(zhCN.novel.ttsErrorProviderFailed).toBe('TTS 服务生成失败');
    expect(zhCN.novel.ttsChapterAudio).toBe('章节音频');
    expect(zhCN.novel.ttsGenerateChapterAudio).toBe('生成章节');
    expect(zhCN.novel.ttsNarrationMode).toBe('朗读模式');
    expect(zhCN.novel.ttsAiMultivoice).toBe('AI 多角色');
    expect(zhCN.novel.ttsGenerateNarrationPlan).toBe('生成计划');
  });

  it('enables AI multivoice from backend advanced feature capabilities', async () => {
    const { supportsTtsAiMultivoice } = await import('@/components/novel/reader/TtsPlayer');

    expect(supportsTtsAiMultivoice({
      advanced_features: { multi_voice: true },
    })).toBe(true);
    expect(supportsTtsAiMultivoice({
      advanced_features: { narration_plan: true },
    })).toBe(true);
  });

  it('does not treat provider-native role_voices as the AI multivoice plan capability', async () => {
    const { supportsTtsAiMultivoice } = await import('@/components/novel/reader/TtsPlayer');

    expect(supportsTtsAiMultivoice({ role_voices: true })).toBe(false);
    expect(supportsTtsAiMultivoice(null)).toBe(false);
  });
});
