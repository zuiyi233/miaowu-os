export interface NativeTtsVoice {
  id: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface NativeSpeechOptions {
  voiceId?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onBoundary?: (index: number, total: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

const MAX_NATIVE_UTTERANCE_CHARS = 180;

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return null;
  return window.speechSynthesis;
}

export function isNativeSpeechSupported(): boolean {
  return getSpeechSynthesis() !== null;
}

function voiceId(voice: SpeechSynthesisVoice): string {
  return `${voice.voiceURI || voice.name}::${voice.lang}`;
}

export function getNativeVoices(): NativeTtsVoice[] {
  const synth = getSpeechSynthesis();
  if (!synth) return [];
  return synth.getVoices().map((voice) => ({
    id: voiceId(voice),
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default,
  }));
}

export function subscribeNativeVoicesChanged(callback: () => void): () => void {
  const synth = getSpeechSynthesis();
  if (!synth) return () => undefined;
  if (synth.addEventListener) {
    synth.addEventListener('voiceschanged', callback);
    return () => {
      if (synth.removeEventListener) {
        synth.removeEventListener('voiceschanged', callback);
      }
    };
  }
  synth.onvoiceschanged = callback;
  return () => { synth.onvoiceschanged = null; };
}

export function chunkNativeSpeechText(text: string, maxChars = MAX_NATIVE_UTTERANCE_CHARS): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;：:\n.…""」』\)]+[。！？!?；;：:\n.…""」』\)]?/g) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + part).length <= maxChars) {
      current += part;
      continue;
    }
    if (current) chunks.push(current);
    if (part.length <= maxChars) {
      current = part;
      continue;
    }
    for (let index = 0; index < part.length; index += maxChars) {
      chunks.push(part.slice(index, index + maxChars));
    }
    current = '';
  }

  if (current) chunks.push(current);
  return chunks;
}

export class NativeSpeechController {
  private readonly synth: SpeechSynthesis | null;
  private queue: string[] = [];
  private index = 0;
  private stopped = false;
  private options: NativeSpeechOptions = {};

  constructor() {
    this.synth = getSpeechSynthesis();
  }

  get supported(): boolean {
    return this.synth !== null;
  }

  speak(text: string, options: NativeSpeechOptions = {}): boolean {
    if (!this.synth) {
      options.onError?.('Native speech synthesis is not supported by this browser');
      return false;
    }
    this.stop();
    this.queue = chunkNativeSpeechText(text);
    this.index = 0;
    this.stopped = false;
    this.options = options;
    if (this.queue.length === 0) return false;
    this.options.onStart?.();
    this.playCurrent();
    return true;
  }

  pause(): void {
    this.synth?.pause();
  }

  resume(): void {
    this.synth?.resume();
  }

  stop(): void {
    this.stopped = true;
    this.synth?.cancel();
    this.queue = [];
    this.index = 0;
  }

  private playCurrent(): void {
    if (!this.synth || this.stopped) return;
    const text = this.queue[this.index];
    if (!text) {
      this.options.onEnd?.();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = this.synth.getVoices();
    const selectedVoice = voices.find((voice) => voiceId(voice) === this.options.voiceId);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = this.options.rate ?? 1;
    utterance.pitch = this.options.pitch ?? 1;
    utterance.volume = this.options.volume ?? 1;
    utterance.onstart = () => {
      this.options.onBoundary?.(this.index, this.queue.length);
    };
    utterance.onend = () => {
      if (this.stopped) return;
      this.index += 1;
      this.options.onBoundary?.(this.index, this.queue.length);
      if (this.index >= this.queue.length) {
        this.options.onEnd?.();
        return;
      }
      this.playCurrent();
    };
    utterance.onerror = (event) => {
      if (this.stopped) return;
      this.options.onError?.(event.error || 'Native speech synthesis failed');
    };
    this.synth.speak(utterance);
  }
}
