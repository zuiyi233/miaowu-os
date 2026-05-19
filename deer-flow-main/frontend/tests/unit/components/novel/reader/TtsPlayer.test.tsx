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
  config: {
    providers: {
      openai: { available: false },
      volcengine: { available: false },
    },
  },
  voices: [],
  selectedProvider: 'openai',
  selectedVoice: undefined,
  setSelectedProvider: vi.fn(),
  setSelectedVoice: vi.fn(),
  speak: vi.fn(),
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
});
