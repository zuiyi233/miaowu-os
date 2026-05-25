import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TtsState } from '@/core/tts/hooks';

const useStateMock = vi.fn();
const useRefMock = vi.fn();
const useEffectMock = vi.fn();
const useCallbackMock = vi.fn();
const generateChapterAudioMock = vi.fn();
const getChapterAudioMock = vi.fn();
const getNarrationPlanMock = vi.fn();
const generateNarrationPlanMock = vi.fn();
const saveNarrationPlanMock = vi.fn();

vi.mock('react', () => ({
  useState: useStateMock,
  useRef: useRefMock,
  useEffect: useEffectMock,
  useCallback: useCallbackMock,
}));

vi.mock('@/core/tts/api', () => ({
  fetchTtsConfig: vi.fn().mockResolvedValue({
    providers: {
      openai: {
        available: true,
        default_model: 'gpt-4o-mini-tts',
        default_format: 'mp3',
        default_speed: 1,
        capabilities: {
          models: ['gpt-4o-mini-tts'],
          formats: ['mp3', 'wav'],
          speed: true,
          instructions: true,
        },
        status: { ready: true, message: 'ready' },
        smoke: { ready: true, message: 'smoke passed' },
      },
      volcengine: { available: false },
      'moss-local': {
        available: true,
        default_model: 'moss-tts-nano',
        default_voice: 'demo-1',
        default_format: 'wav',
        capabilities: {
          formats: ['wav'],
          speed: true,
          advanced_options: ['seed', 'text_temperature', 'top_p'],
        },
        status: { ready: true, message: 'MOSS ready' },
      },
    },
    default_provider: 'openai',
  }),
  fetchTtsVoices: vi.fn().mockResolvedValue([
    { id: 'alloy', name: 'Alloy', provider: 'openai', language: 'multi' },
  ]),
  synthesizeSpeech: vi.fn(),
  generateChapterAudio: generateChapterAudioMock,
  getChapterAudio: getChapterAudioMock,
  getChapterAudioDownloadUrl: vi.fn(() => 'http://127.0.0.1:8551/api/tts/chapters/chapter-1/download'),
  getNarrationPlan: getNarrationPlanMock,
  generateNarrationPlan: generateNarrationPlanMock,
  saveNarrationPlan: saveNarrationPlanMock,
  getTtsJob: vi.fn(),
  cancelTtsJob: vi.fn(),
  retryTtsJob: vi.fn(),
}));

function createNoopAudio(): HTMLAudioElement {
  return {
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    addEventListener: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    currentTime: 0,
    duration: 0,
  } as unknown as HTMLAudioElement;
}

function createInitialState(): TtsState {
  return {
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
    narrationMode: 'single_narrator',
    narrationPlan: null,
    narrationPlanLoading: false,
    narrationPlanGenerating: false,
    speakerVoices: {},
    playbackEngine: 'server',
    nativeSupported: false,
    nativeVoices: [],
    nativeVoiceId: undefined,
    nativeRate: 1,
    nativePitch: 1,
    browserExporting: false,
    browserExportSupported: false,
    browserExportAvailable: false,
  };
}

describe('useTts state shape', () => {
  beforeEach(() => {
    useStateMock.mockReset();
    useRefMock.mockReset();
    useEffectMock.mockReset();
    useCallbackMock.mockReset();
    generateChapterAudioMock.mockReset();
    getChapterAudioMock.mockReset();
    getNarrationPlanMock.mockReset();
    generateNarrationPlanMock.mockReset();
    saveNarrationPlanMock.mockReset();

    useCallbackMock.mockImplementation((fn: unknown) => fn);
    useEffectMock.mockImplementation(() => undefined);

    let stateIndex = 0;
    const stateValues = [
      createInitialState(),
      null,
      [],
      'openai',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'single_narrator',
      {},
      'device',
      undefined,
      1,
      1,
    ] as const;
    useStateMock.mockImplementation(() => {
      const value = stateValues[stateIndex] ?? undefined;
      stateIndex += 1;
      return [value, vi.fn()];
    });

    useRefMock
      .mockReturnValueOnce({ current: createNoopAudio() })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: 0 })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: 0 });
  });

  it('exposes errorCode on returned state', async () => {
    const { useTts } = await import('@/core/tts/hooks');
    const result = useTts();
    expect(result.errorCode).toBeNull();
  });

  it('exposes provider capability, status, smoke, and advanced option state', async () => {
    const { useTts } = await import('@/core/tts/hooks');
    const result = useTts();

    expect(result.capabilities).toBeNull();
    expect(result.status).toBeNull();
    expect(result.smoke).toBeNull();
    expect(result.providerError).toBeNull();
    expect(result.selectedModel).toBeUndefined();
    expect(result.selectedFormat).toBeUndefined();
    expect(result.selectedSpeed).toBeUndefined();
    expect(result.instructions).toBeUndefined();
    expect(result.advancedOptions).toBeUndefined();
    expect(result.narrationMode).toBe('single_narrator');
    expect(result.narrationPlan).toBeNull();
    expect(result.narrationPlanLoading).toBe(false);
    expect(result.narrationPlanGenerating).toBe(false);
    expect(result.speakerVoices).toEqual({});
    expect(result.chapterAudio).toBeNull();
    expect(result.chapterLoading).toBe(false);
    expect(result.chapterGenerating).toBe(false);
    expect(result.chapterJob).toBeNull();
    expect(result.chapterCacheState).toBe('unknown');
    expect(result.downloadUrl).toBeNull();
    expect(typeof result.setSelectedModel).toBe('function');
    expect(typeof result.setSelectedFormat).toBe('function');
    expect(typeof result.setSelectedSpeed).toBe('function');
    expect(typeof result.setInstructions).toBe('function');
    expect(typeof result.setAdvancedOptions).toBe('function');
    expect(typeof result.setNarrationMode).toBe('function');
    expect(typeof result.setSpeakerVoices).toBe('function');
    expect(typeof result.loadNarrationPlan).toBe('function');
    expect(typeof result.generatePlan).toBe('function');
    expect(typeof result.savePlan).toBe('function');
    expect(typeof result.loadChapterAudio).toBe('function');
    expect(typeof result.generateChapter).toBe('function');
    expect(typeof result.cancelChapterJob).toBe('function');
    expect(typeof result.retryChapterJob).toBe('function');
  });

  it('clears stale chapter job when a new chapter generation starts', async () => {
    const stateUpdates: Array<(state: TtsState) => TtsState> = [];
    generateChapterAudioMock.mockResolvedValue({
      job: { job_id: 'job-new', status: 'partial' },
      cache_state: 'miss',
    });
    useStateMock.mockImplementationOnce(() => [
      {
        ...createInitialState(),
        chapterJob: {
          job_id: 'job-old',
          chapter_id: 'chapter-1',
          status: 'failed',
          total_chunks: 1,
          completed_chunks: 0,
          failed_chunks: 1,
          cached_chunks: 0,
        },
      },
      (updater: (state: TtsState) => TtsState) => stateUpdates.push(updater),
    ]);

    const { useTts } = await import('@/core/tts/hooks');
    const result = useTts();

    await result.generateChapter('chapter-1', '章节正文', { provider: 'moss-local' });

    const startState = stateUpdates[0]!(createInitialState());
    expect(startState.chapterGenerating).toBe(true);
    expect(startState.chapterLoading).toBe(false);
    expect(startState.chapterJob).toBeNull();
    const completionState = stateUpdates.at(-1)!(startState);
    expect(completionState.chapterJob?.status).toBe('partial');
    expect(completionState.chapterGenerating).toBe(false);
  });

  it('keeps chapter audio loading, plan loading, and generation abort controllers isolated', async () => {
    const pending = new Promise<never>(() => {});
    getChapterAudioMock.mockReturnValue(pending);
    getNarrationPlanMock.mockReturnValue(pending);
    generateChapterAudioMock.mockReturnValue(pending);

    const refs = Array.from({ length: 13 }, () => ({ current: null as unknown }));
    refs[0] = { current: createNoopAudio() };
    refs[9] = { current: 0 };
    refs[12] = { current: 0 };
    useRefMock.mockReset();
    useRefMock.mockImplementation(() => refs.shift() ?? { current: null });

    const { useTts } = await import('@/core/tts/hooks');
    const result = useTts();

    void result.loadChapterAudio('chapter-1', { project_id: 'novel-1' });
    const chapterAudioController = refs.length;
    const audioSignal = getChapterAudioMock.mock.calls[0]![1].signal as AbortSignal;

    void result.loadNarrationPlan('chapter-1', { project_id: 'novel-1' });
    const planSignal = getNarrationPlanMock.mock.calls[0]![1].signal as AbortSignal;

    void result.generateChapter('chapter-1', '章节正文', { project_id: 'novel-1' });
    const generateSignal = generateChapterAudioMock.mock.calls[0]![0].signal as AbortSignal;

    expect(chapterAudioController).toBeGreaterThanOrEqual(0);
    expect(audioSignal).not.toBe(planSignal);
    expect(audioSignal).not.toBe(generateSignal);
    expect(planSignal).not.toBe(generateSignal);
    expect(audioSignal.aborted).toBe(false);
    expect(planSignal.aborted).toBe(false);
    expect(generateSignal.aborted).toBe(false);
  });
});
