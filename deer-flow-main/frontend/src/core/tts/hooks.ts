'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TtsApiError,
  cancelTtsJob,
  fetchTtsConfig,
  fetchTtsVoices,
  generateChapterAudio,
  generateNarrationPlan,
  getChapterAudio,
  getChapterAudioDownloadUrl,
  getNarrationPlan,
  getTtsJob,
  retryTtsJob,
  saveNarrationPlan,
  synthesizeSpeech,
  type TtsAdvancedOptions,
  type TtsCacheState,
  type TtsChapterAudioManifest,
  type TtsChapterRequestOptions,
  type TtsConfig,
  type TtsErrorCode,
  type TtsJob,
  type TtsNarrationMode,
  type TtsNarrationPlan,
  type TtsNarrationPlanRequestOptions,
  type TtsProvider,
  type TtsProviderCapabilities,
  type TtsProviderConfig,
  type TtsProviderError,
  type TtsProviderStatus,
  type TtsSpeakerVoiceMapping,
  type TtsVoiceInfo,
} from './api';
import {
  NativeSpeechController,
  getNativeVoices,
  isNativeSpeechSupported,
  subscribeNativeVoicesChanged,
  type NativeTtsVoice,
} from './nativeSpeech';
import {
  canExportManifestInBrowser,
  downloadBlob,
  exportChapterMp3InBrowser,
} from './browserFfmpegExport';

export type TtsPlaybackEngine = 'device' | 'server';

export interface UseTtsOptions {
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  fmt?: string;
  speed?: number;
  instructions?: string;
  advancedOptions?: TtsAdvancedOptions;
  narrationMode?: TtsNarrationMode;
  speakerVoices?: TtsSpeakerVoiceMapping;
  playbackEngine?: TtsPlaybackEngine;
  nativeVoiceId?: string;
  nativeRate?: number;
  nativePitch?: number;
}

export interface TtsState {
  playing: boolean;
  loading: boolean;
  error: string | null;
  errorCode: TtsErrorCode | string | null;
  progress: number;
  duration: number;
  currentTime: number;
  status: TtsProviderStatus | null;
  smoke: TtsProviderStatus | null;
  providerError: TtsProviderError | null;
  chapterAudio: TtsChapterAudioManifest | null;
  chapterLoading: boolean;
  chapterGenerating: boolean;
  chapterJob: TtsJob | null;
  chapterCacheState: TtsCacheState;
  downloadUrl: string | null;
  narrationMode: TtsNarrationMode;
  narrationPlan: TtsNarrationPlan | null;
  narrationPlanLoading: boolean;
  narrationPlanGenerating: boolean;
  speakerVoices: TtsSpeakerVoiceMapping;
  playbackEngine: TtsPlaybackEngine;
  nativeSupported: boolean;
  nativeVoices: NativeTtsVoice[];
  nativeVoiceId?: string;
  nativeRate: number;
  nativePitch: number;
  browserExporting: boolean;
  browserExportSupported: boolean;
  browserExportAvailable: boolean;
}

const INITIAL_STATE: TtsState = {
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

function _cleanupAudio(audio: HTMLAudioElement | null, blobUrl: string | null) {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }
}

function getProviderConfig(config: TtsConfig | null, provider: TtsProvider): TtsProviderConfig | null {
  return config?.providers?.[provider] ?? null;
}

function getProviderCapabilities(config: TtsConfig | null, provider: TtsProvider): TtsProviderCapabilities | null {
  return getProviderConfig(config, provider)?.capabilities ?? null;
}

function getProviderDefaultModel(config: TtsConfig | null, provider: TtsProvider): string | undefined {
  return getProviderConfig(config, provider)?.default_model ?? config?.default_model ?? undefined;
}

function getProviderDefaultFormat(config: TtsConfig | null, provider: TtsProvider): string | undefined {
  return getProviderConfig(config, provider)?.default_format ?? config?.default_format ?? undefined;
}

function getProviderDefaultSpeed(config: TtsConfig | null, provider: TtsProvider): number | undefined {
  return getProviderConfig(config, provider)?.default_speed ?? config?.default_speed ?? undefined;
}

function getProviderStatus(config: TtsConfig | null, provider: TtsProvider): TtsProviderStatus | null {
  return getProviderConfig(config, provider)?.status ?? null;
}

function getProviderSmoke(config: TtsConfig | null, provider: TtsProvider): TtsProviderStatus | null {
  return getProviderConfig(config, provider)?.smoke ?? config?.smoke ?? null;
}

function getProviderError(config: TtsConfig | null, provider: TtsProvider): TtsProviderError | null {
  return getProviderConfig(config, provider)?.error ?? config?.error ?? null;
}

function buildProviderRuntimeState(config: TtsConfig | null, provider: TtsProvider) {
  return {
    status: getProviderStatus(config, provider),
    smoke: getProviderSmoke(config, provider),
    providerError: getProviderError(config, provider),
  };
}

export function useTts(options: UseTtsOptions = {}) {
  const [state, setState] = useState<TtsState>(INITIAL_STATE);
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<TtsProvider>(options.provider ?? 'openai');
  const [selectedVoice, setSelectedVoice] = useState<string | undefined>(options.voice);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(options.model);
  const [selectedFormat, setSelectedFormat] = useState<string | undefined>(options.fmt);
  const [selectedSpeed, setSelectedSpeed] = useState<number | undefined>(options.speed);
  const [instructions, setInstructions] = useState<string | undefined>(options.instructions);
  const [advancedOptions, setAdvancedOptions] = useState<TtsAdvancedOptions | undefined>(options.advancedOptions);
  const [narrationMode, setNarrationMode] = useState<TtsNarrationMode>(options.narrationMode ?? 'single_narrator');
  const [speakerVoices, setSpeakerVoices] = useState<TtsSpeakerVoiceMapping>(options.speakerVoices ?? {});
  const [playbackEngine, setPlaybackEngineState] = useState<TtsPlaybackEngine>(options.playbackEngine ?? 'device');
  const [nativeVoiceId, setNativeVoiceId] = useState<string | undefined>(options.nativeVoiceId);
  const [nativeRate, setNativeRate] = useState<number>(options.nativeRate ?? 1);
  const [nativePitch, setNativePitch] = useState<number>(options.nativePitch ?? 1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeSpeechRef = useRef<NativeSpeechController | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chapterAudioAbortRef = useRef<AbortController | null>(null);
  const narrationPlanLoadAbortRef = useRef<AbortController | null>(null);
  const narrationPlanGenerateAbortRef = useRef<AbortController | null>(null);
  const narrationPlanSaveAbortRef = useRef<AbortController | null>(null);
  const chapterGenerateAbortRef = useRef<AbortController | null>(null);
  const speakSeqRef = useRef(0);
  const jobPollRef = useRef<number | null>(null);
  const chapterAudioQueryKeyRef = useRef<string | null>(null);
  const chapterAudioMutationSeqRef = useRef(0);

  const setError = useCallback((message: string, errorCode: TtsErrorCode | string) => {
    setState((s) => ({ ...s, error: message, errorCode }));
  }, []);

  useEffect(() => {
    const supported = isNativeSpeechSupported();
    const nativeVoices = getNativeVoices();
    nativeSpeechRef.current = supported ? new NativeSpeechController() : null;
    setState((s) => ({
      ...s,
      nativeSupported: supported,
      nativeVoices,
      nativeVoiceId: nativeVoiceId ?? nativeVoices.find((voice) => voice.default)?.id ?? nativeVoices[0]?.id,
      playbackEngine: supported ? playbackEngine : 'server',
      browserExportSupported: typeof window !== 'undefined' && typeof WebAssembly !== 'undefined',
    }));
    const unsubscribe = subscribeNativeVoicesChanged(() => {
      const voices = getNativeVoices();
      setState((s) => ({
        ...s,
        nativeVoices: voices,
        nativeVoiceId: s.nativeVoiceId ?? voices.find((voice) => voice.default)?.id ?? voices[0]?.id,
      }));
    });
    return () => {
      nativeSpeechRef.current?.stop();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setState((s) => ({
      ...s,
      playbackEngine,
      nativeVoiceId,
      nativeRate,
      nativePitch,
    }));
  }, [nativePitch, nativeRate, nativeVoiceId, playbackEngine]);

  useEffect(() => {
    setState((s) => ({
      ...s,
      browserExportSupported: typeof window !== 'undefined' && typeof WebAssembly !== 'undefined',
      browserExportAvailable: canExportManifestInBrowser(s.chapterAudio),
    }));
  }, [state.chapterAudio]);

  useEffect(() => {
    fetchTtsConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (!options.provider && cfg.default_provider) {
          setSelectedProvider(cfg.default_provider);
        }
        const provider = options.provider ?? cfg.default_provider ?? 'openai';
        setSelectedModel((prev) => prev ?? options.model ?? getProviderDefaultModel(cfg, provider));
        setSelectedFormat((prev) => prev ?? options.fmt ?? getProviderDefaultFormat(cfg, provider));
        setSelectedSpeed((prev) => prev ?? options.speed ?? getProviderDefaultSpeed(cfg, provider));
        setState((s) => ({ ...s, ...buildProviderRuntimeState(cfg, provider) }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load TTS config';
        setState((s) => (s.error ? s : { ...s, error: message, errorCode: 'load_config' }));
      });
  }, [options.fmt, options.model, options.provider, options.speed]);

  useEffect(() => {
    setState((s) => ({ ...s, ...buildProviderRuntimeState(config, selectedProvider) }));
    setSelectedModel(options.model ?? getProviderDefaultModel(config, selectedProvider));
    setSelectedFormat(options.fmt ?? getProviderDefaultFormat(config, selectedProvider));
    setSelectedSpeed(options.speed ?? getProviderDefaultSpeed(config, selectedProvider));
  }, [config, options.fmt, options.model, options.speed, selectedProvider]);

  useEffect(() => {
    fetchTtsVoices(selectedProvider, selectedModel)
      .then((v) => {
        setVoices(v);
        setSelectedVoice((prev) => {
          if (v.length === 0) return undefined;
          const stillValid = v.some((voice) => voice.id === prev);
          return stillValid ? prev : v[0]!.id;
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load TTS voices';
        setState((s) => (s.error ? s : { ...s, error: message, errorCode: 'load_voices' }));
      });
  }, [selectedModel, selectedProvider]);

  useEffect(() => {
    return () => {
      _cleanupAudio(audioRef.current, blobUrlRef.current);
      nativeSpeechRef.current?.stop();
      audioRef.current = null;
      blobUrlRef.current = null;
      abortRef.current?.abort();
      chapterAudioAbortRef.current?.abort();
      narrationPlanLoadAbortRef.current?.abort();
      narrationPlanGenerateAbortRef.current?.abort();
      narrationPlanSaveAbortRef.current?.abort();
      chapterGenerateAbortRef.current?.abort();
      if (jobPollRef.current) {
        window.clearInterval(jobPollRef.current);
        jobPollRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    _cleanupAudio(audioRef.current, blobUrlRef.current);
    nativeSpeechRef.current?.stop();
    audioRef.current = null;
    blobUrlRef.current = null;
    abortRef.current?.abort();
    setState({
      ...INITIAL_STATE,
      ...buildProviderRuntimeState(config, selectedProvider),
      playbackEngine,
      nativeSupported: isNativeSpeechSupported(),
      nativeVoices: getNativeVoices(),
      nativeVoiceId,
      nativeRate,
      nativePitch,
      browserExportSupported: typeof window !== 'undefined' && typeof WebAssembly !== 'undefined',
    });
  }, [config, nativePitch, nativeRate, nativeVoiceId, playbackEngine, selectedProvider]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null, errorCode: null }));
  }, []);

  const applyChapterAudio = useCallback((audio: TtsChapterAudioManifest | null) => {
    setState((s) => ({
      ...s,
      chapterAudio: audio,
      chapterCacheState: audio?.cache_state ?? (audio?.cached ? 'hit' : audio ? 'miss' : 'unknown'),
      downloadUrl: getChapterAudioDownloadUrl(audio),
      browserExportAvailable: canExportManifestInBrowser(audio),
    }));
  }, []);

  const clearChapterAudio = useCallback(() => {
    setState((s) => ({
      ...s,
      chapterAudio: null,
      chapterCacheState: 'unknown',
      downloadUrl: null,
      browserExportAvailable: false,
    }));
  }, []);

  const buildChapterAudioQueryKey = useCallback((
    chapterId: string,
    options: Partial<Omit<TtsChapterRequestOptions, 'chapter_id' | 'text'>>,
  ) => JSON.stringify({
    chapterId,
    project_id: options.project_id ?? null,
    provider: options.provider ?? null,
    voice: options.voice ?? null,
    model: options.model ?? null,
    fmt: options.fmt ?? null,
    speed: options.speed ?? null,
    instructions: options.instructions ?? null,
    mode: options.mode ?? null,
    plan_id: options.plan_id ?? null,
    speaker_voices: options.speaker_voices
      ? Object.fromEntries(Object.entries(options.speaker_voices).sort(([a], [b]) => a.localeCompare(b)))
      : null,
  }), []);

  const buildChapterOptions = useCallback((
    chapterId: string,
    text: string,
    overrides: Partial<TtsChapterRequestOptions> = {},
  ): TtsChapterRequestOptions => ({
    chapter_id: chapterId,
    text,
    provider: overrides.provider ?? selectedProvider,
    voice: overrides.voice ?? selectedVoice,
    model: overrides.model ?? selectedModel,
    fmt: overrides.fmt ?? selectedFormat,
    speed: overrides.speed ?? selectedSpeed,
    instructions: overrides.instructions ?? instructions,
    advanced_options: overrides.advanced_options ?? advancedOptions,
    mode: overrides.mode ?? narrationMode,
    plan_id: overrides.plan_id ?? state.narrationPlan?.plan_id ?? undefined,
    speaker_voices: overrides.speaker_voices ?? speakerVoices,
    project_id: overrides.project_id,
    title: overrides.title,
    force: overrides.force,
    signal: overrides.signal,
  }), [
    advancedOptions,
    instructions,
    narrationMode,
    selectedFormat,
    selectedModel,
    selectedProvider,
    selectedSpeed,
    selectedVoice,
    speakerVoices,
    state.narrationPlan?.plan_id,
  ]);

  const buildNarrationPlanOptions = useCallback((
    chapterId: string,
    text: string | undefined,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ): TtsNarrationPlanRequestOptions => ({
    chapter_id: chapterId,
    text: overrides.text ?? text,
    provider: overrides.provider ?? selectedProvider,
    voice: overrides.voice ?? selectedVoice,
    model: overrides.model ?? selectedModel,
    fmt: overrides.fmt ?? selectedFormat,
    speed: overrides.speed ?? selectedSpeed,
    instructions: overrides.instructions ?? instructions,
    advanced_options: overrides.advanced_options ?? advancedOptions,
    mode: overrides.mode ?? narrationMode,
    speaker_voices: overrides.speaker_voices ?? speakerVoices,
    project_id: overrides.project_id,
    title: overrides.title,
    plan: overrides.plan,
    signal: overrides.signal,
  }), [
    advancedOptions,
    instructions,
    narrationMode,
    selectedFormat,
    selectedModel,
    selectedProvider,
    selectedSpeed,
    selectedVoice,
    speakerVoices,
  ]);

  const loadChapterAudio = useCallback(async (
    chapterId: string,
    overrides: Partial<Omit<TtsChapterRequestOptions, 'chapter_id' | 'text'>> = {},
  ) => {
    if (!chapterId) return null;
    chapterAudioAbortRef.current?.abort();
    const controller = new AbortController();
    chapterAudioAbortRef.current = controller;
    const requestOptions = {
      provider: overrides.provider ?? selectedProvider,
      voice: overrides.voice ?? selectedVoice,
      model: overrides.model ?? selectedModel,
      fmt: overrides.fmt ?? selectedFormat,
      speed: overrides.speed ?? selectedSpeed,
      instructions: overrides.instructions ?? instructions,
      project_id: overrides.project_id,
      mode: overrides.mode ?? narrationMode,
      plan_id: overrides.plan_id ?? state.narrationPlan?.plan_id ?? undefined,
      speaker_voices: overrides.speaker_voices ?? speakerVoices,
      signal: controller.signal,
    };
    const queryKey = buildChapterAudioQueryKey(chapterId, requestOptions);
    if (chapterAudioQueryKeyRef.current !== queryKey) {
      chapterAudioQueryKeyRef.current = queryKey;
      clearChapterAudio();
    }
    const mutationSeq = chapterAudioMutationSeqRef.current;
    setState((s) => ({
      ...s,
      chapterLoading: true,
      error: null,
      errorCode: null,
    }));
    try {
      const audio = await getChapterAudio(chapterId, requestOptions);
      if (chapterAudioMutationSeqRef.current !== mutationSeq) {
        setState((s) => ({ ...s, chapterLoading: false }));
        return null;
      }
      if (chapterAudioQueryKeyRef.current !== queryKey) return null;
      applyChapterAudio(audio);
      setState((s) => ({ ...s, chapterLoading: false }));
      return audio;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to load chapter audio';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        chapterLoading: false,
        error: message,
        errorCode,
      }));
      return null;
    }
  }, [
    applyChapterAudio,
    buildChapterAudioQueryKey,
    clearChapterAudio,
    instructions,
    narrationMode,
    selectedFormat,
    selectedModel,
    selectedProvider,
    selectedSpeed,
    selectedVoice,
    speakerVoices,
    state.narrationPlan?.plan_id,
  ]);

  const applyNarrationPlan = useCallback((plan: TtsNarrationPlan | null) => {
    setState((s) => ({
      ...s,
      narrationPlan: plan,
      narrationMode: plan ? 'ai_multivoice' : s.narrationMode,
    }));
    if (plan) {
      setNarrationMode('ai_multivoice');
      chapterAudioQueryKeyRef.current = null;
      clearChapterAudio();
    }
  }, [clearChapterAudio]);

  const loadNarrationPlan = useCallback(async (
    chapterId: string,
    overrides: Pick<TtsNarrationPlanRequestOptions, 'project_id'> = {},
  ) => {
    if (!chapterId) return null;
    narrationPlanLoadAbortRef.current?.abort();
    const controller = new AbortController();
    narrationPlanLoadAbortRef.current = controller;
    setState((s) => ({
      ...s,
      narrationPlanLoading: true,
      error: null,
      errorCode: null,
    }));
    try {
      const plan = await getNarrationPlan(chapterId, {
        project_id: overrides.project_id,
        signal: controller.signal,
      });
      applyNarrationPlan(plan);
      setState((s) => ({ ...s, narrationPlanLoading: false }));
      return plan;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to load narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        narrationPlanLoading: false,
        error: message,
        errorCode,
      }));
      return null;
    }
  }, [applyNarrationPlan]);

  const generatePlan = useCallback(async (
    chapterId: string,
    text: string,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ) => {
    if (!chapterId || !text.trim()) return null;
    narrationPlanGenerateAbortRef.current?.abort();
    const controller = new AbortController();
    narrationPlanGenerateAbortRef.current = controller;
    setState((s) => ({
      ...s,
      narrationPlanGenerating: true,
      error: null,
      errorCode: null,
    }));
    try {
      const plan = await generateNarrationPlan(buildNarrationPlanOptions(chapterId, text, {
        ...overrides,
        signal: controller.signal,
      }));
      applyNarrationPlan(plan);
      setState((s) => ({ ...s, narrationPlanGenerating: false }));
      return plan;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to generate narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        narrationPlanGenerating: false,
        error: message,
        errorCode,
      }));
      return null;
    }
  }, [applyNarrationPlan, buildNarrationPlanOptions]);

  const savePlan = useCallback(async (
    chapterId: string,
    plan: TtsNarrationPlan,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ) => {
    if (!chapterId) return null;
    narrationPlanSaveAbortRef.current?.abort();
    const controller = new AbortController();
    narrationPlanSaveAbortRef.current = controller;
    setState((s) => ({
      ...s,
      narrationPlanLoading: true,
      error: null,
      errorCode: null,
    }));
    try {
      const saved = await saveNarrationPlan({
        ...buildNarrationPlanOptions(chapterId, undefined, {
          ...overrides,
          plan,
          signal: controller.signal,
        }),
        plan,
      });
      applyNarrationPlan(saved);
      setState((s) => ({ ...s, narrationPlanLoading: false }));
      return saved;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to save narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        narrationPlanLoading: false,
        error: message,
        errorCode,
      }));
      return null;
    }
  }, [applyNarrationPlan, buildNarrationPlanOptions]);

  const startJobPolling = useCallback((jobId: string) => {
    if (jobPollRef.current) {
      window.clearInterval(jobPollRef.current);
      jobPollRef.current = null;
    }

    jobPollRef.current = window.setInterval(() => {
      getTtsJob(jobId)
        .then((job) => {
          setState((s) => ({
            ...s,
            chapterJob: job,
            chapterGenerating: job.status === 'queued' || job.status === 'running',
          }));
          if (job.audio) {
            applyChapterAudio(job.audio);
          }
          if (!['queued', 'running'].includes(job.status)) {
            if (jobPollRef.current) {
              window.clearInterval(jobPollRef.current);
              jobPollRef.current = null;
            }
            if (job.error) {
              setState((s) => ({
                ...s,
                error: job.error?.message ?? 'TTS chapter generation failed',
                errorCode: job.error?.code ?? 'synthesis',
              }));
            }
          }
        })
        .catch((err: unknown) => {
          if (jobPollRef.current) {
            window.clearInterval(jobPollRef.current);
            jobPollRef.current = null;
          }
          const message = err instanceof Error ? err.message : 'Failed to load TTS job';
          const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
          setState((s) => ({
            ...s,
            chapterGenerating: false,
            error: message,
            errorCode,
          }));
        });
    }, 1500);
  }, [applyChapterAudio]);

  const generateChapter = useCallback(async (
    chapterId: string,
    text: string,
    overrides: Partial<TtsChapterRequestOptions> = {},
  ) => {
    if (!chapterId || !text.trim()) return null;
    chapterGenerateAbortRef.current?.abort();
    const controller = new AbortController();
    chapterGenerateAbortRef.current = controller;
    chapterAudioMutationSeqRef.current += 1;
    setState((s) => ({
      ...s,
      chapterGenerating: true,
      chapterLoading: false,
      chapterJob: null,
      error: null,
      errorCode: null,
    }));
    try {
      const response = await generateChapterAudio(buildChapterOptions(chapterId, text, {
        ...overrides,
        signal: controller.signal,
      }));
      if (response.audio) {
        applyChapterAudio(response.audio);
      }
      const job = response.job ?? (response.job_id ? { job_id: response.job_id, status: 'queued' as const } : null);
      setState((s) => ({
        ...s,
        chapterJob: job,
        chapterGenerating: job ? ['queued', 'running'].includes(job.status) : false,
        chapterCacheState: response.cache_state ?? (response.cached ? 'hit' : s.chapterCacheState),
      }));
      if (job && ['queued', 'running'].includes(job.status)) {
        startJobPolling(job.job_id);
      }
      return response;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'TTS chapter generation failed';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        chapterGenerating: false,
        error: message,
        errorCode,
      }));
      return null;
    }
  }, [applyChapterAudio, buildChapterOptions, startJobPolling]);

  const updateNarrationMode = useCallback((mode: TtsNarrationMode) => {
    setNarrationMode(mode);
    setState((s) => ({ ...s, narrationMode: mode }));
    chapterAudioQueryKeyRef.current = null;
    clearChapterAudio();
  }, [clearChapterAudio]);

  const updateSpeakerVoices = useCallback((voices: TtsSpeakerVoiceMapping) => {
    setSpeakerVoices(voices);
    setState((s) => ({ ...s, speakerVoices: voices }));
    chapterAudioQueryKeyRef.current = null;
    clearChapterAudio();
  }, [clearChapterAudio]);

  const cancelChapterJob = useCallback(async () => {
    const jobId = state.chapterJob?.job_id;
    if (!jobId) return null;
    const job = await cancelTtsJob(jobId);
    setState((s) => ({
      ...s,
      chapterJob: job,
      chapterGenerating: false,
      error: job.error?.message ?? s.error,
      errorCode: job.error?.code ?? s.errorCode,
    }));
    if (jobPollRef.current) {
      window.clearInterval(jobPollRef.current);
      jobPollRef.current = null;
    }
    return job;
  }, [state.chapterJob?.job_id]);

  const retryChapterJob = useCallback(async () => {
    const jobId = state.chapterJob?.job_id;
    if (!jobId) return null;
    const job = await retryTtsJob(jobId);
    setState((s) => ({
      ...s,
      chapterJob: job,
      chapterGenerating: ['queued', 'running'].includes(job.status),
      error: null,
      errorCode: null,
    }));
    if (['queued', 'running'].includes(job.status)) {
      startJobPolling(job.job_id);
    }
    return job;
  }, [startJobPolling, state.chapterJob?.job_id]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    _cleanupAudio(audioRef.current, blobUrlRef.current);
    nativeSpeechRef.current?.stop();
    audioRef.current = null;
    blobUrlRef.current = null;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const seq = ++speakSeqRef.current;

    setState((s) => ({
      ...s,
      playbackEngine,
      playing: false,
      loading: true,
      error: null,
      errorCode: null,
      progress: 0,
      currentTime: 0,
      duration: 0,
    }));

    if (playbackEngine === 'device') {
      const controller = nativeSpeechRef.current;
      if (!controller?.supported) {
        setState((s) => ({
          ...s,
          playing: false,
          loading: false,
          error: 'Native speech synthesis is not supported by this browser',
          errorCode: 'unsupported_provider',
        }));
        return;
      }
      const started = controller.speak(text, {
        voiceId: nativeVoiceId,
        rate: nativeRate,
        pitch: nativePitch,
        onStart: () => {
          setState((s) => ({
            ...s,
            playing: true,
            loading: false,
            currentTime: 0,
            duration: 0,
            progress: 0,
          }));
        },
        onBoundary: (index, total) => {
          const progress = total > 0 ? Math.min(100, Math.round((index / total) * 100)) : 0;
          setState((s) => ({
            ...s,
            progress,
            currentTime: index,
            duration: total,
          }));
        },
        onEnd: () => {
          setState((s) => ({
            ...s,
            playing: false,
            loading: false,
            progress: 100,
          }));
        },
        onError: (message) => {
          setState((s) => ({
            ...s,
            playing: false,
            loading: false,
            error: message,
            errorCode: 'playback',
          }));
        },
      });
      if (!started) {
        setState((s) => ({ ...s, loading: false }));
      }
      return;
    }

    try {
      const blob = await synthesizeSpeech({
        text,
        provider: selectedProvider,
        voice: selectedVoice,
        model: selectedModel,
        fmt: selectedFormat,
        speed: selectedSpeed,
        instructions,
        advanced_options: advancedOptions,
        signal: abortRef.current.signal,
      });

      if (seq !== speakSeqRef.current) return;

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('loadedmetadata', () => {
        if (seq !== speakSeqRef.current) return;
        setState((s) => ({ ...s, loading: false, duration: audio.duration }));
      });

      audio.addEventListener('timeupdate', () => {
        if (seq !== speakSeqRef.current) return;
        const progress = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        setState((s) => ({ ...s, progress, currentTime: audio.currentTime }));
      });

      audio.addEventListener('ended', () => {
        if (seq !== speakSeqRef.current) return;
        setState((s) => ({ ...s, playing: false, progress: 100 }));
      });

      audio.addEventListener('error', () => {
        if (seq !== speakSeqRef.current) return;
        setState((s) => ({
          ...s,
          playing: false,
          loading: false,
          error: 'Audio playback error',
          errorCode: 'playback',
          progress: 0,
          currentTime: 0,
          duration: 0,
          ...buildProviderRuntimeState(config, selectedProvider),
        }));
      });

      await audio.play();
      if (seq !== speakSeqRef.current) return;
      setState((s) => ({ ...s, playing: true, loading: false }));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (seq !== speakSeqRef.current) return;
      const message = err instanceof Error ? err.message : 'TTS synthesis failed';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setState((s) => ({
        ...s,
        playing: false,
        loading: false,
        error: message,
        errorCode,
        progress: 0,
        currentTime: 0,
        duration: 0,
        ...buildProviderRuntimeState(config, selectedProvider),
      }));
    }
  }, [
    advancedOptions,
    config,
    instructions,
    nativePitch,
    nativeRate,
    nativeVoiceId,
    playbackEngine,
    selectedFormat,
    selectedModel,
    selectedProvider,
    selectedSpeed,
    selectedVoice,
  ]);

  const pause = useCallback(() => {
    if (playbackEngine === 'device') {
      nativeSpeechRef.current?.pause();
      setState((s) => ({ ...s, playing: false }));
    } else if (audioRef.current) {
      audioRef.current.pause();
      setState((s) => ({ ...s, playing: false }));
    }
  }, [playbackEngine]);

  const resume = useCallback(() => {
    if (playbackEngine === 'device') {
      nativeSpeechRef.current?.resume();
      setState((s) => ({ ...s, playing: true }));
    } else if (audioRef.current) {
      audioRef.current.play().catch((err: DOMException) => {
        if (err.name === 'NotAllowedError') {
          setError('浏览器阻止了自动播放，请手动点击播放', 'autoplay_blocked');
        }
      });
      setState((s) => ({ ...s, playing: true }));
    }
  }, [playbackEngine, setError]);

  const seek = useCallback((fraction: number) => {
    if (playbackEngine === 'device') {
      return;
    }
    if (audioRef.current?.duration) {
      audioRef.current.currentTime = fraction * audioRef.current.duration;
    }
  }, [playbackEngine]);

  const setPlaybackEngine = useCallback((engine: TtsPlaybackEngine) => {
    const next = engine === 'device' && !isNativeSpeechSupported() ? 'server' : engine;
    setPlaybackEngineState(next);
    setState((s) => ({ ...s, playbackEngine: next }));
  }, []);

  const exportChapterInBrowser = useCallback(async () => {
    if (!state.chapterAudio) return null;
    setState((s) => ({
      ...s,
      browserExporting: true,
      error: null,
      errorCode: null,
    }));
    try {
      const result = await exportChapterMp3InBrowser(state.chapterAudio);
      downloadBlob(result.blob, result.filename);
      setState((s) => ({ ...s, browserExporting: false }));
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Browser MP3 export failed';
      setState((s) => ({
        ...s,
        browserExporting: false,
        error: message,
        errorCode: 'provider_failed',
      }));
      return null;
    }
  }, [state.chapterAudio]);

  return {
    ...state,
    config,
    voices,
    selectedProvider,
    selectedVoice,
    selectedModel,
    selectedFormat,
    selectedSpeed,
    instructions,
    advancedOptions,
    playbackEngine,
    setPlaybackEngine,
    nativeSupported: state.nativeSupported,
    nativeVoices: state.nativeVoices,
    nativeVoiceId: state.nativeVoiceId ?? nativeVoiceId,
    nativeRate,
    nativePitch,
    setNativeVoiceId,
    setNativeRate,
    setNativePitch,
    browserExporting: state.browserExporting,
    browserExportSupported: state.browserExportSupported,
    browserExportAvailable: state.browserExportAvailable,
    exportChapterInBrowser,
    capabilities: getProviderCapabilities(config, selectedProvider),
    setSelectedProvider,
    setSelectedVoice,
    setSelectedModel,
    setSelectedFormat,
    setSelectedSpeed,
    setInstructions,
    setAdvancedOptions,
    narrationMode,
    narrationPlan: state.narrationPlan,
    narrationPlanLoading: state.narrationPlanLoading,
    narrationPlanGenerating: state.narrationPlanGenerating,
    speakerVoices,
    setNarrationMode: updateNarrationMode,
    setSpeakerVoices: updateSpeakerVoices,
    loadNarrationPlan,
    generatePlan,
    savePlan,
    speak,
    loadChapterAudio,
    generateChapter,
    cancelChapterJob,
    retryChapterJob,
    pause,
    resume,
    stop,
    seek,
    clearError,
  };
}
