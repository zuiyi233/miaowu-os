import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeSpeechController, chunkNativeSpeechText, getNativeVoices, isNativeSpeechSupported } from '@/core/tts/nativeSpeech';

afterEach(() => {
  vi.unstubAllGlobals();
});

function installSpeechMock() {
  const spoken: SpeechSynthesisUtterance[] = [];
  const voices = [
    {
      voiceURI: 'voice-a',
      name: 'Voice A',
      lang: 'zh-CN',
      localService: true,
      default: true,
    } as SpeechSynthesisVoice,
  ];
  const synth = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
      spoken.push(utterance);
      utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onvoiceschanged: null,
  } as unknown as SpeechSynthesis;

  const Utterance = class {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
    onend: ((event: SpeechSynthesisEvent) => void) | null = null;
    onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('window', {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: Utterance,
  });

  return { synth, spoken, voices };
}

describe('native speech engine', () => {
  it('chunks long text for mobile-safe speech queues', () => {
    const chunks = chunkNativeSpeechText('第一句很短。第二句也很短。第三句需要继续朗读。', 12);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
  });

  it('detects support and exposes device voices', () => {
    const { voices } = installSpeechMock();

    expect(isNativeSpeechSupported()).toBe(true);
    expect(getNativeVoices()).toEqual([
      {
        id: `${voices[0]!.voiceURI}::${voices[0]!.lang}`,
        name: 'Voice A',
        lang: 'zh-CN',
        localService: true,
        default: true,
      },
    ]);
  });

  it('queues utterances with selected voice, rate, and pitch', () => {
    const { spoken, voices } = installSpeechMock();
    const onEnd = vi.fn();
    const controller = new NativeSpeechController();

    const started = controller.speak('第一句。第二句。', {
      voiceId: `${voices[0]!.voiceURI}::${voices[0]!.lang}`,
      rate: 1.3,
      pitch: 0.8,
      onEnd,
    });

    expect(started).toBe(true);
    expect(spoken[0]?.voice).toBe(voices[0]);
    expect(spoken[0]?.rate).toBe(1.3);
    expect(spoken[0]?.pitch).toBe(0.8);

    spoken[0]?.onend?.(new Event('end') as SpeechSynthesisEvent);
    expect(onEnd).toHaveBeenCalled();
  });
});
