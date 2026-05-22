import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TtsState } from '@/core/tts/hooks';

const useStateMock = vi.fn();
const useRefMock = vi.fn();
const useEffectMock = vi.fn();
const useCallbackMock = vi.fn();

vi.mock('react', () => ({
  useState: useStateMock,
  useRef: useRefMock,
  useEffect: useEffectMock,
  useCallback: useCallbackMock,
}));

vi.mock('@/core/tts/api', () => ({
  fetchTtsConfig: vi.fn().mockResolvedValue({
    providers: {
      openai: { available: true },
      volcengine: { available: false },
    },
    default_provider: 'openai',
  }),
  fetchTtsVoices: vi.fn().mockResolvedValue([
    { id: 'alloy', name: 'Alloy', provider: 'openai', language: 'multi' },
  ]),
  synthesizeSpeech: vi.fn(),
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
  };
}

describe('useTts state shape', () => {
  beforeEach(() => {
    useStateMock.mockReset();
    useRefMock.mockReset();
    useEffectMock.mockReset();
    useCallbackMock.mockReset();

    useCallbackMock.mockImplementation((fn: unknown) => fn);
    useEffectMock.mockImplementation(() => undefined);

    let stateIndex = 0;
    const stateValues = [
      createInitialState(),
      null,
      [],
      'openai',
      undefined,
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
      .mockReturnValueOnce({ current: 0 });
  });

  it('exposes errorCode on returned state', async () => {
    const { useTts } = await import('@/core/tts/hooks');
    const result = useTts();
    expect(result.errorCode).toBeNull();
  });
});

