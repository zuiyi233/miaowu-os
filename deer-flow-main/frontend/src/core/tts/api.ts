import { fetch as authFetch } from '@/core/api/fetcher';
import { getBackendBaseURL } from '@/core/config';

export type TtsProvider = 'openai' | 'volcengine';

export interface TtsVoiceInfo {
  id: string;
  name: string;
  provider: TtsProvider;
  language: string;
}

export interface TtsConfig {
  providers: {
    openai: { available: boolean };
    volcengine: { available: boolean };
  };
  default_provider: TtsProvider | null;
}

export interface TtsSynthesizeOptions {
  text: string;
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  fmt?: string;
  speed?: number;
  signal?: AbortSignal;
}

function ttsUrl(path: string): string {
  return `${getBackendBaseURL()}/api/tts${path}`;
}

export async function fetchTtsConfig(): Promise<TtsConfig> {
  const res = await authFetch(ttsUrl('/config'));
  if (!res.ok) throw new Error(`Failed to fetch TTS config: ${res.status}`);
  return res.json();
}

export async function fetchTtsVoices(provider?: TtsProvider): Promise<TtsVoiceInfo[]> {
  const query = provider ? `?provider=${provider}` : '';
  const res = await authFetch(ttsUrl(`/voices${query}`));
  if (!res.ok) throw new Error(`Failed to fetch TTS voices: ${res.status}`);
  const data = await res.json();
  return data.voices ?? [];
}

export async function synthesizeSpeech(options: TtsSynthesizeOptions): Promise<Blob> {
  const res = await authFetch(ttsUrl('/synthesize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: options.text,
      provider: options.provider ?? 'openai',
      voice: options.voice ?? undefined,
      model: options.model ?? undefined,
      fmt: options.fmt ?? undefined,
      speed: options.speed ?? undefined,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    let detail = `TTS synthesis failed: ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.detail) detail = errBody.detail;
    } catch {}
    throw new Error(detail);
  }

  return res.blob();
}
