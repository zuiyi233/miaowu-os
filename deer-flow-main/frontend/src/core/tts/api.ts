import { fetch as authFetch } from '@/core/api/fetcher';
import { getBackendBaseURL } from '@/core/config';

export type TtsProvider = 'openai' | 'volcengine' | 'moss-local' | 'mimo';

export type TtsErrorCode =
  | 'missing_config'
  | 'invalid_request'
  | 'unsupported_provider'
  | 'unsupported_model'
  | 'unsupported_endpoint'
  | 'auth_failed'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_failed'
  | 'storage_unavailable'
  | 'quota_exceeded'
  | 'generation_cancelled'
  | 'load_config'
  | 'load_voices'
  | 'synthesis'
  | 'playback'
  | 'autoplay_blocked';

export interface TtsProviderCapabilities {
  models?: string[];
  voices?: string[];
  formats?: string[];
  speed?: boolean;
  instructions?: boolean;
  role_voices?: boolean;
  advanced_features?: {
    multi_voice?: boolean;
    narration_plan?: boolean;
    [key: string]: unknown;
  };
  smoke?: boolean;
  streaming?: boolean;
  advanced_options?: string[];
  [key: string]: unknown;
}

export interface TtsProviderStatus {
  ready?: boolean;
  checked_at?: string;
  message?: string | null;
  warmup?: unknown;
  text_normalization?: unknown;
  [key: string]: unknown;
}

export interface TtsProviderError {
  code: TtsErrorCode | string;
  message: string;
  detail?: unknown;
}

export interface TtsProviderConfig {
  available: boolean;
  provider?: TtsProvider;
  label?: string;
  default_model?: string | null;
  default_voice?: string | null;
  default_format?: string | null;
  default_speed?: number | null;
  capabilities?: TtsProviderCapabilities;
  status?: TtsProviderStatus;
  smoke?: TtsProviderStatus | null;
  error?: TtsProviderError | null;
  diagnostics?: string[];
  [key: string]: unknown;
}

export interface TtsVoiceInfo {
  id: string;
  name: string;
  provider: TtsProvider;
  language: string;
}

export interface TtsConfig {
  providers: Partial<Record<TtsProvider, TtsProviderConfig>> & Record<string, TtsProviderConfig>;
  default_provider: TtsProvider | null;
  default_model?: string | null;
  default_voice?: string | null;
  default_format?: string | null;
  default_speed?: number | null;
  smoke?: TtsProviderStatus | null;
  error?: TtsProviderError | null;
}

export type MossLocalAdvancedOptions = {
  seed?: number;
  text_temperature?: number;
  audio_temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  normalize_text?: boolean;
  demo_id?: string;
};

export type MimoAdvancedOptions = {
  prompt?: string;
  reference_audio_asset_id?: string;
  reference_audio_data_url?: string;
};

export interface TtsRoleVoice {
  role: string;
  voice: string;
}

export type TtsAdvancedOptions = (MossLocalAdvancedOptions | MimoAdvancedOptions) & Record<string, unknown>;

export type TtsNarrationMode = 'single_narrator' | 'ai_multivoice';

export interface TtsRoleVoiceReference {
  voice?: string | null;
  provider?: TtsProvider | null;
  model?: string | null;
  mode?: 'design' | 'clone' | null;
  character_id?: string | null;
  role_id?: string | null;
  display_name?: string | null;
  aliases?: string[];
  gender?: string | null;
  age?: string | null;
  personality?: string | null;
  voice_description?: string | null;
  reference_audio_asset_id?: string | null;
  generated_sample_asset_id?: string | null;
  status?: 'pending' | 'generating' | 'ready' | 'error' | null;
  locked?: boolean | null;
  diagnostics?: string[];
  metadata?: Record<string, unknown>;
}

export interface TtsNarrationSpeaker {
  id: string;
  display_name: string;
  voice: string;
  role_voice?: TtsRoleVoiceReference | null;
  style?: string | null;
  instructions?: string | null;
  confidence?: number | null;
}

export interface TtsNarrationSegment {
  id?: string | null;
  speaker_id: string;
  text?: string | null;
  voice?: string | null;
  role_voice?: TtsRoleVoiceReference | null;
  style?: string | null;
  instructions?: string | null;
  confidence?: number | null;
  warnings?: string[];
}

export type TtsSpeakerVoiceMapping = Record<string, string | TtsRoleVoiceReference>;

export interface TtsNarrationPlan {
  plan_id?: string | null;
  chapter_id?: string | null;
  provider?: TtsProvider | null;
  model?: string | null;
  default_voice?: string | null;
  speakers: TtsNarrationSpeaker[];
  segments: TtsNarrationSegment[];
  confidence?: number | null;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface TtsSynthesizeOptions {
  text: string;
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  fmt?: string;
  speed?: number;
  instructions?: string;
  advanced_options?: TtsAdvancedOptions;
  signal?: AbortSignal;
}

export interface TtsChapterRequestOptions extends Omit<TtsSynthesizeOptions, 'signal'> {
  chapter_id: string;
  project_id?: string;
  title?: string;
  force?: boolean;
  mode?: TtsNarrationMode;
  plan_id?: string;
  speaker_voices?: TtsSpeakerVoiceMapping;
  signal?: AbortSignal;
}

export interface TtsNarrationPlanRequestOptions extends Partial<Omit<TtsSynthesizeOptions, 'signal'>> {
  chapter_id: string;
  text?: string;
  project_id?: string;
  title?: string;
  mode?: TtsNarrationMode;
  plan?: TtsNarrationPlan;
  auto_plan?: boolean;
  speaker_voices?: TtsSpeakerVoiceMapping;
  signal?: AbortSignal;
}

export type TtsJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'partial';

export type TtsCacheState = 'unknown' | 'hit' | 'miss' | 'stale';

export interface TtsChapterAudioSegment {
  index: number;
  asset_id?: string;
  url?: string;
  download_url?: string;
  duration?: number;
  content_type?: string;
  fingerprint?: string;
}

export interface TtsChapterAudioManifest {
  chapter_id: string;
  project_id?: string | null;
  asset_id?: string | null;
  url?: string | null;
  download_url?: string | null;
  content_type?: string | null;
  duration?: number | null;
  fingerprint?: string | null;
  cache_state?: TtsCacheState;
  cached?: boolean;
  generated_at?: string | null;
  provider?: TtsProvider | string | null;
  model?: string | null;
  voice?: string | null;
  format?: string | null;
  segments?: TtsChapterAudioSegment[];
  timestamps_url?: string | null;
  export_urls?: Record<string, string>;
  error?: TtsProviderError | null;
}

function normalizeSpeakerVoices(speakerVoices: TtsSpeakerVoiceMapping | undefined): string | null {
  if (!speakerVoices || Object.keys(speakerVoices).length === 0) return null;
  const sorted = Object.entries(speakerVoices)
    .filter(([speaker, voice]) => speaker && voice)
    .sort(([a], [b]) => a.localeCompare(b));
  return sorted.length > 0 ? JSON.stringify(Object.fromEntries(sorted)) : null;
}

export interface TtsJobProgress {
  total_chapters?: number;
  completed_chapters?: number;
  total_chunks?: number;
  completed_chunks?: number;
  failed_chunks?: number;
  percent?: number;
  current_chapter_id?: string | null;
  current_chunk?: number | null;
}

export interface TtsJob {
  job_id: string;
  status: TtsJobStatus;
  chapter_id?: string | null;
  project_id?: string | null;
  progress?: TtsJobProgress;
  audio?: TtsChapterAudioManifest | null;
  error?: TtsProviderError | null;
  error_code?: TtsErrorCode | string | null;
  detail?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TtsChapterGenerateResponse {
  job?: TtsJob;
  job_id?: string;
  audio?: TtsChapterAudioManifest | null;
  cache_state?: TtsCacheState;
  cached?: boolean;
}

export interface TtsGeneratedAudioResponse {
  asset_id: string;
  url: string;
  download_url: string;
  content_type: string;
  provider: TtsProvider;
  model?: string | null;
  metadata?: Record<string, unknown>;
  diagnostics?: string[];
}

export interface TtsVoiceDesignOptions {
  voice_description: string;
  text?: string;
  instruction?: string;
  model?: string;
  fmt?: string;
  ai_provider_id?: string;
  signal?: AbortSignal;
}

export interface TtsVoiceCloneOptions {
  text?: string;
  reference_audio_asset_id?: string;
  reference_audio_data_url?: string;
  instruction?: string;
  style?: string;
  model?: string;
  fmt?: string;
  ai_provider_id?: string;
  signal?: AbortSignal;
}

export interface TtsStyleOptimizeOptions {
  style_text: string;
  model?: string;
  ai_provider_id?: string;
  signal?: AbortSignal;
}

export interface TtsVoiceDesignOptimizeOptions {
  voice_description: string;
  model?: string;
  ai_provider_id?: string;
  signal?: AbortSignal;
}

export interface TtsTextOptimizeResponse {
  text: string;
  provider: TtsProvider;
  model?: string | null;
  metadata?: Record<string, unknown>;
}

function ttsUrl(path: string): string {
  return `${getBackendBaseURL()}/api/tts${path}`;
}

function backendUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${getBackendBaseURL()}${url}`;
  return url;
}

function normalizeApiErrorBody(body: unknown, fallback: string): { message: string; code: TtsErrorCode | string } {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object') {
      const detailRecord = detail as { code?: unknown; error_code?: unknown; message?: unknown };
      const code = typeof detailRecord.code === 'string'
        ? detailRecord.code
        : typeof detailRecord.error_code === 'string'
          ? detailRecord.error_code
        : 'synthesis';
      const message = typeof detailRecord.message === 'string'
        ? detailRecord.message
        : fallback;
      return { message, code };
    }
    if (typeof detail === 'string') {
      return { message: detail, code: 'synthesis' };
    }
  }

  if (body && typeof body === 'object') {
    const code = typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : 'synthesis';
    const message = typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : fallback;
    return { message, code };
  }

  return { message: fallback, code: 'synthesis' };
}

export class TtsApiError extends Error {
  readonly code: TtsErrorCode | string;
  readonly status: number;

  constructor(message: string, code: TtsErrorCode | string, status: number) {
    super(message);
    this.name = 'TtsApiError';
    this.code = code;
    this.status = status;
  }
}

async function readTtsApiError(res: Response, fallbackCode: TtsErrorCode | string): Promise<TtsApiError> {
  const fallback = `TTS request failed: ${res.status}`;
  let errBody: unknown = null;
  try {
    errBody = await res.json();
  } catch {}
  const normalized = normalizeApiErrorBody(errBody, fallback);
  return new TtsApiError(normalized.message, normalized.code || fallbackCode, res.status);
}

export async function fetchTtsConfig(): Promise<TtsConfig> {
  const res = await authFetch(ttsUrl('/config'));
  if (!res.ok) throw new Error(`Failed to fetch TTS config: ${res.status}`);
  return res.json();
}

export async function fetchTtsVoices(provider?: TtsProvider, model?: string): Promise<TtsVoiceInfo[]> {
  const params = new URLSearchParams();
  if (provider) params.set('provider', provider);
  if (model) params.set('model', model);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(ttsUrl(`/voices${query}`));
  if (!res.ok) throw new Error(`Failed to fetch TTS voices: ${res.status}`);
  const data = await res.json();
  return data.voices ?? [];
}

function buildChapterPayload(options: TtsChapterRequestOptions) {
  return {
    text: options.text,
    project_id: options.project_id ?? undefined,
    title: options.title ?? undefined,
    provider: options.provider ?? undefined,
    voice: options.voice ?? undefined,
    model: options.model ?? undefined,
    fmt: options.fmt ?? undefined,
    speed: options.speed ?? undefined,
    instructions: options.instructions ?? undefined,
    advanced_options: options.advanced_options ?? undefined,
    mode: options.mode ?? undefined,
    plan_id: options.plan_id ?? undefined,
    speaker_voices: options.speaker_voices ?? undefined,
    force: options.force ?? undefined,
  };
}

function buildNarrationPlanPayload(options: TtsNarrationPlanRequestOptions) {
  return {
    text: options.text ?? undefined,
    project_id: options.project_id ?? undefined,
    title: options.title ?? undefined,
    provider: options.provider ?? undefined,
    voice: options.voice ?? undefined,
    model: options.model ?? undefined,
    fmt: options.fmt ?? undefined,
    speed: options.speed ?? undefined,
    instructions: options.instructions ?? undefined,
    advanced_options: options.advanced_options ?? undefined,
    mode: options.mode ?? undefined,
    plan: options.plan ?? undefined,
    auto_plan: options.auto_plan ?? undefined,
    speaker_voices: options.speaker_voices ?? undefined,
  };
}

function normalizeTtsJob(raw: unknown): TtsJob {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const jobRecord = record.job && typeof record.job === 'object'
    ? record.job as Record<string, unknown>
    : record;
  const error = jobRecord.error && typeof jobRecord.error === 'object'
    ? jobRecord.error as TtsProviderError
    : typeof jobRecord.error_code === 'string' || typeof jobRecord.detail === 'string'
      ? {
        code: typeof jobRecord.error_code === 'string' ? jobRecord.error_code : 'synthesis',
        message: typeof jobRecord.detail === 'string' ? jobRecord.detail : 'TTS job failed',
      }
      : null;

  return {
    job_id: typeof jobRecord.job_id === 'string' ? jobRecord.job_id : '',
    status: typeof jobRecord.status === 'string' ? jobRecord.status as TtsJobStatus : 'failed',
    chapter_id: typeof jobRecord.chapter_id === 'string' ? jobRecord.chapter_id : null,
    project_id: typeof jobRecord.project_id === 'string' ? jobRecord.project_id : null,
    progress: jobRecord.progress && typeof jobRecord.progress === 'object' ? jobRecord.progress as TtsJobProgress : undefined,
    audio: jobRecord.audio && typeof jobRecord.audio === 'object' ? jobRecord.audio as TtsChapterAudioManifest : null,
    error,
    error_code: typeof jobRecord.error_code === 'string' ? jobRecord.error_code : null,
    detail: typeof jobRecord.detail === 'string' ? jobRecord.detail : null,
    created_at: typeof jobRecord.created_at === 'string' ? jobRecord.created_at : null,
    updated_at: typeof jobRecord.updated_at === 'string' ? jobRecord.updated_at : null,
  };
}

export async function synthesizeSpeech(options: TtsSynthesizeOptions): Promise<Blob> {
  const res = await authFetch(ttsUrl('/synthesize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: options.text,
      provider: options.provider ?? undefined,
      voice: options.voice ?? undefined,
      model: options.model ?? undefined,
      fmt: options.fmt ?? undefined,
      speed: options.speed ?? undefined,
      instructions: options.instructions ?? undefined,
      advanced_options: options.advanced_options ?? undefined,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw await readTtsApiError(res, 'synthesis');
  }

  return res.blob();
}

export async function designTtsVoice(options: TtsVoiceDesignOptions): Promise<TtsGeneratedAudioResponse> {
  const res = await authFetch(ttsUrl('/voices/design'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: options.voice_description,
      text: options.text ?? undefined,
      instruction: options.instruction ?? undefined,
      model: options.model ?? undefined,
      fmt: options.fmt ?? undefined,
      ai_provider_id: options.ai_provider_id ?? undefined,
    }),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return res.json();
}

export async function cloneTtsVoice(options: TtsVoiceCloneOptions): Promise<TtsGeneratedAudioResponse> {
  const res = await authFetch(ttsUrl('/voices/clone'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: options.text ?? undefined,
      reference_audio_asset_id: options.reference_audio_asset_id ?? undefined,
      reference_audio_data_url: options.reference_audio_data_url ?? undefined,
      instruction: options.instruction ?? undefined,
      style: options.style ?? undefined,
      model: options.model ?? undefined,
      fmt: options.fmt ?? undefined,
      ai_provider_id: options.ai_provider_id ?? undefined,
    }),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return res.json();
}

export async function optimizeTtsStyle(options: TtsStyleOptimizeOptions): Promise<TtsTextOptimizeResponse> {
  const res = await authFetch(ttsUrl('/style/optimize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      style_text: options.style_text,
      model: options.model ?? undefined,
      ai_provider_id: options.ai_provider_id ?? undefined,
    }),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return res.json();
}

export async function optimizeTtsVoiceDesign(options: TtsVoiceDesignOptimizeOptions): Promise<TtsTextOptimizeResponse> {
  const res = await authFetch(ttsUrl('/voice-design/optimize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: options.voice_description,
      model: options.model ?? undefined,
      ai_provider_id: options.ai_provider_id ?? undefined,
    }),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return res.json();
}

export async function getChapterAudio(
  chapterId: string,
  options: Partial<Omit<TtsChapterRequestOptions, 'chapter_id' | 'text'>> = {},
): Promise<TtsChapterAudioManifest | null> {
  const params = new URLSearchParams();
  if (options.project_id) params.set('project_id', options.project_id);
  if (options.provider) params.set('provider', options.provider);
  if (options.model) params.set('model', options.model);
  if (options.voice) params.set('voice', options.voice);
  if (options.fmt) params.set('fmt', options.fmt);
  if (typeof options.speed === 'number') params.set('speed', String(options.speed));
  if (options.instructions) params.set('instructions', options.instructions);
  if (options.mode) params.set('mode', options.mode);
  if (options.plan_id) params.set('plan_id', options.plan_id);
  const speakerVoices = normalizeSpeakerVoices(options.speaker_voices);
  if (speakerVoices) params.set('speaker_voices', speakerVoices);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(ttsUrl(`/chapters/${encodeURIComponent(chapterId)}/audio${query}`), {
    signal: options.signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  const data = await res.json();
  return data.audio ?? data;
}

export async function generateChapterAudio(
  options: TtsChapterRequestOptions,
): Promise<TtsChapterGenerateResponse> {
  const res = await authFetch(ttsUrl(`/chapters/${encodeURIComponent(options.chapter_id)}/generate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChapterPayload(options)),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return res.json();
}

export async function getNarrationPlan(
  chapterId: string,
  options: Pick<TtsNarrationPlanRequestOptions, 'project_id' | 'signal'> = {},
): Promise<TtsNarrationPlan | null> {
  const params = new URLSearchParams();
  if (options.project_id) params.set('project_id', options.project_id);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(ttsUrl(`/chapters/${encodeURIComponent(chapterId)}/plan${query}`), {
    signal: options.signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  const data = await res.json();
  return data.plan ?? data;
}

export async function generateNarrationPlan(
  options: TtsNarrationPlanRequestOptions,
): Promise<TtsNarrationPlan> {
  const res = await authFetch(ttsUrl(`/chapters/${encodeURIComponent(options.chapter_id)}/plan`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildNarrationPlanPayload({ ...options, auto_plan: options.auto_plan ?? true })),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  const data = await res.json();
  return data.plan ?? data;
}

export async function saveNarrationPlan(
  options: TtsNarrationPlanRequestOptions & { plan: TtsNarrationPlan },
): Promise<TtsNarrationPlan> {
  const res = await authFetch(ttsUrl(`/chapters/${encodeURIComponent(options.chapter_id)}/plan`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildNarrationPlanPayload(options)),
    signal: options.signal,
  });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  const data = await res.json();
  return data.plan ?? data;
}

export async function getTtsJob(jobId: string, signal?: AbortSignal): Promise<TtsJob> {
  const res = await authFetch(ttsUrl(`/jobs/${encodeURIComponent(jobId)}`), { signal });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return normalizeTtsJob(await res.json());
}

export async function cancelTtsJob(jobId: string): Promise<TtsJob> {
  const res = await authFetch(ttsUrl(`/jobs/${encodeURIComponent(jobId)}/cancel`), { method: 'POST' });
  if (!res.ok) throw await readTtsApiError(res, 'generation_cancelled');
  return normalizeTtsJob(await res.json());
}

export async function retryTtsJob(jobId: string): Promise<TtsJob> {
  const res = await authFetch(ttsUrl(`/jobs/${encodeURIComponent(jobId)}/retry`), { method: 'POST' });
  if (!res.ok) throw await readTtsApiError(res, 'synthesis');
  return normalizeTtsJob(await res.json());
}

export function getChapterAudioDownloadUrl(audio: TtsChapterAudioManifest | null): string | null {
  if (!audio) return null;
  if (audio.download_url) return backendUrl(audio.download_url);
  if (audio.url) return backendUrl(audio.url);
  if (audio.segments?.length === 1) {
    return backendUrl(audio.segments[0]?.download_url ?? audio.segments[0]?.url);
  }
  if (audio.segments && audio.segments.length > 1) {
    return backendUrl(`/api/tts/chapters/${encodeURIComponent(audio.chapter_id)}/download`);
  }
  return null;
}
