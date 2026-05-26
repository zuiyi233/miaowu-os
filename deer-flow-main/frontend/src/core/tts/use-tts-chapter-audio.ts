'use client';

import { useCallback, useRef, useState } from 'react';

import {
  TtsApiError,
  cancelTtsJob,
  generateChapterAudio,
  getChapterAudio,
  getChapterAudioDownloadUrl,
  getTtsJob,
  retryTtsJob,
  type TtsAdvancedOptions,
  type TtsCacheState,
  type TtsChapterAudioManifest,
  type TtsChapterGenerateResponse,
  type TtsChapterRequestOptions,
  type TtsJob,
  type TtsNarrationMode,
  type TtsNarrationPlan,
  type TtsProvider,
  type TtsSpeakerVoiceMapping,
} from './api';
import { canExportManifestInBrowser } from './browserFfmpegExport';
import type { TtsState } from './tts-state';

export interface UseTtsChapterAudioReturn {
  chapterAudio: TtsChapterAudioManifest | null;
  chapterLoading: boolean;
  chapterGenerating: boolean;
  chapterJob: TtsJob | null;
  chapterCacheState: TtsCacheState;
  downloadUrl: string | null;
  loadChapterAudio: (chapterId: string, overrides?: Partial<TtsChapterRequestOptions>) => Promise<TtsChapterAudioManifest | null>;
  generateChapter: (chapterId: string, text: string, overrides?: Partial<TtsChapterRequestOptions>) => Promise<TtsChapterGenerateResponse | null>;
  cancelChapterJob: () => Promise<TtsJob | null>;
  retryChapterJob: () => Promise<TtsJob | null>;
}

export function useTtsChapterAudio(
  configDeps: {
    selectedProvider: TtsProvider;
    selectedVoice: string | undefined;
    selectedModel: string | undefined;
    selectedFormat: string | undefined;
    selectedSpeed: number | undefined;
    instructions: string | undefined;
    advancedOptions: TtsAdvancedOptions | undefined;
    narrationMode: TtsNarrationMode;
    speakerVoices: TtsSpeakerVoiceMapping;
  },
  narrationPlanDeps: {
    narrationPlan: TtsNarrationPlan | null;
  },
  onStateChange: (updates: Partial<TtsState>) => void,
): UseTtsChapterAudioReturn {
  const [chapterAudio, setChapterAudio] = useState<TtsChapterAudioManifest | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterGenerating, setChapterGenerating] = useState(false);
  const [chapterJob, setChapterJob] = useState<TtsJob | null>(null);
  const [chapterCacheState, setChapterCacheState] = useState<TtsCacheState>('unknown');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const chapterAudioAbortRef = useRef<AbortController | null>(null);
  const chapterGenerateAbortRef = useRef<AbortController | null>(null);
  const chapterAudioQueryKeyRef = useRef<string | null>(null);
  const chapterAudioMutationSeqRef = useRef(0);
  const jobPollRef = useRef<number | null>(null);
  const jobPollAbortRef = useRef<AbortController | null>(null);

  const applyChapterAudio = useCallback((audio: TtsChapterAudioManifest | null) => {
    setChapterAudio(audio);
    setChapterCacheState(audio?.cache_state ?? (audio?.cached ? 'hit' : audio ? 'miss' : 'unknown'));
    setDownloadUrl(getChapterAudioDownloadUrl(audio));
    onStateChange({
      chapterAudio: audio,
      chapterCacheState: audio?.cache_state ?? (audio?.cached ? 'hit' : audio ? 'miss' : 'unknown'),
      downloadUrl: getChapterAudioDownloadUrl(audio),
      browserExportAvailable: canExportManifestInBrowser(audio),
    });
  }, [onStateChange]);

  const clearChapterAudio = useCallback(() => {
    setChapterAudio(null);
    setChapterCacheState('unknown');
    setDownloadUrl(null);
    onStateChange({
      chapterAudio: null,
      chapterCacheState: 'unknown',
      downloadUrl: null,
      browserExportAvailable: false,
    });
  }, [onStateChange]);

  const buildChapterAudioQueryKey = useCallback((
    chapterId: string,
    opts: Partial<Omit<TtsChapterRequestOptions, 'chapter_id' | 'text'>>,
  ) => JSON.stringify({
    chapterId,
    project_id: opts.project_id ?? null,
    provider: opts.provider ?? null,
    voice: opts.voice ?? null,
    model: opts.model ?? null,
    fmt: opts.fmt ?? null,
    speed: opts.speed ?? null,
    instructions: opts.instructions ?? null,
    mode: opts.mode ?? null,
    plan_id: opts.plan_id ?? null,
    speaker_voices: opts.speaker_voices
      ? Object.fromEntries(Object.entries(opts.speaker_voices).sort(([a], [b]) => a.localeCompare(b)))
      : null,
  }), []);

  const buildChapterOptions = useCallback((
    chapterId: string,
    text: string,
    overrides: Partial<TtsChapterRequestOptions> = {},
  ): TtsChapterRequestOptions => ({
    chapter_id: chapterId,
    text,
    provider: overrides.provider ?? configDeps.selectedProvider,
    voice: overrides.voice ?? configDeps.selectedVoice,
    model: overrides.model ?? configDeps.selectedModel,
    fmt: overrides.fmt ?? configDeps.selectedFormat,
    speed: overrides.speed ?? configDeps.selectedSpeed,
    instructions: overrides.instructions ?? configDeps.instructions,
    advanced_options: overrides.advanced_options ?? configDeps.advancedOptions,
    mode: overrides.mode ?? configDeps.narrationMode,
    plan_id: overrides.plan_id ?? narrationPlanDeps.narrationPlan?.plan_id ?? undefined,
    speaker_voices: overrides.speaker_voices ?? configDeps.speakerVoices,
    project_id: overrides.project_id,
    title: overrides.title,
    force: overrides.force,
    signal: overrides.signal,
  }), [
    configDeps.advancedOptions,
    configDeps.instructions,
    configDeps.narrationMode,
    configDeps.selectedFormat,
    configDeps.selectedModel,
    configDeps.selectedProvider,
    configDeps.selectedSpeed,
    configDeps.selectedVoice,
    configDeps.speakerVoices,
    narrationPlanDeps.narrationPlan?.plan_id,
  ]);

  const startJobPolling = useCallback((jobId: string) => {
    if (jobPollRef.current) {
      window.clearInterval(jobPollRef.current);
      jobPollRef.current = null;
    }

    const pollAbort = new AbortController();
    jobPollAbortRef.current = pollAbort;

    jobPollRef.current = window.setInterval(() => {
      getTtsJob(jobId, pollAbort.signal)
        .then((job) => {
          setChapterJob(job);
          setChapterGenerating(job.status === 'queued' || job.status === 'running');
          onStateChange({
            chapterJob: job,
            chapterGenerating: job.status === 'queued' || job.status === 'running',
          });
          if (job.audio) {
            applyChapterAudio(job.audio);
          }
          if (!['queued', 'running'].includes(job.status)) {
            if (jobPollRef.current) {
              window.clearInterval(jobPollRef.current);
              jobPollRef.current = null;
            }
            pollAbort.abort();
            if (job.error) {
              onStateChange({
                error: job.error?.message ?? 'TTS chapter generation failed',
                errorCode: job.error?.code ?? 'synthesis',
              });
            }
          }
        })
        .catch((err: unknown) => {
          if (jobPollRef.current) {
            window.clearInterval(jobPollRef.current);
            jobPollRef.current = null;
          }
          pollAbort.abort();
          const message = err instanceof Error ? err.message : 'Failed to load TTS job';
          const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
          setChapterGenerating(false);
          onStateChange({
            chapterGenerating: false,
            error: message,
            errorCode,
          });
        });
    }, 1500);
  }, [applyChapterAudio, onStateChange]);

  const loadChapterAudio = useCallback(async (
    chapterId: string,
    overrides: Partial<Omit<TtsChapterRequestOptions, 'chapter_id' | 'text'>> = {},
  ) => {
    if (!chapterId) return null;
    chapterAudioAbortRef.current?.abort();
    const controller = new AbortController();
    chapterAudioAbortRef.current = controller;
    const requestOptions = {
      provider: overrides.provider ?? configDeps.selectedProvider,
      voice: overrides.voice ?? configDeps.selectedVoice,
      model: overrides.model ?? configDeps.selectedModel,
      fmt: overrides.fmt ?? configDeps.selectedFormat,
      speed: overrides.speed ?? configDeps.selectedSpeed,
      instructions: overrides.instructions ?? configDeps.instructions,
      project_id: overrides.project_id,
      mode: overrides.mode ?? configDeps.narrationMode,
      plan_id: overrides.plan_id ?? narrationPlanDeps.narrationPlan?.plan_id ?? undefined,
      speaker_voices: overrides.speaker_voices ?? configDeps.speakerVoices,
      signal: controller.signal,
    };
    const queryKey = buildChapterAudioQueryKey(chapterId, requestOptions);
    if (chapterAudioQueryKeyRef.current !== queryKey) {
      chapterAudioQueryKeyRef.current = queryKey;
      clearChapterAudio();
    }
    const mutationSeq = chapterAudioMutationSeqRef.current;
    setChapterLoading(true);
    onStateChange({
      chapterLoading: true,
      error: null,
      errorCode: null,
    });
    try {
      const audio = await getChapterAudio(chapterId, requestOptions);
      if (chapterAudioMutationSeqRef.current !== mutationSeq) {
        setChapterLoading(false);
        onStateChange({ chapterLoading: false });
        return null;
      }
      if (chapterAudioQueryKeyRef.current !== queryKey) return null;
      applyChapterAudio(audio);
      setChapterLoading(false);
      onStateChange({ chapterLoading: false });
      return audio;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to load chapter audio';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setChapterLoading(false);
      onStateChange({
        chapterLoading: false,
        error: message,
        errorCode,
      });
      return null;
    }
  }, [
    applyChapterAudio,
    buildChapterAudioQueryKey,
    clearChapterAudio,
    configDeps.instructions,
    configDeps.narrationMode,
    configDeps.selectedFormat,
    configDeps.selectedModel,
    configDeps.selectedProvider,
    configDeps.selectedSpeed,
    configDeps.selectedVoice,
    configDeps.speakerVoices,
    narrationPlanDeps.narrationPlan?.plan_id,
    onStateChange,
  ]);

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
    setChapterGenerating(true);
    setChapterLoading(false);
    setChapterJob(null);
    onStateChange({
      chapterGenerating: true,
      chapterLoading: false,
      chapterJob: null,
      error: null,
      errorCode: null,
    });
    try {
      const response = await generateChapterAudio(buildChapterOptions(chapterId, text, {
        ...overrides,
        signal: controller.signal,
      }));
      if (response.audio) {
        applyChapterAudio(response.audio);
      }
      const job = response.job ?? (response.job_id ? { job_id: response.job_id, status: 'queued' as const } : null);
      setChapterJob(job);
      setChapterGenerating(job ? ['queued', 'running'].includes(job.status) : false);
      setChapterCacheState(response.cache_state ?? (response.cached ? 'hit' : chapterCacheState));
      onStateChange({
        chapterJob: job,
        chapterGenerating: job ? ['queued', 'running'].includes(job.status) : false,
        chapterCacheState: response.cache_state ?? (response.cached ? 'hit' : chapterCacheState),
      });
      if (job && ['queued', 'running'].includes(job.status)) {
        startJobPolling(job.job_id);
      }
      return response;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'TTS chapter generation failed';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setChapterGenerating(false);
      onStateChange({
        chapterGenerating: false,
        error: message,
        errorCode,
      });
      return null;
    }
  }, [applyChapterAudio, buildChapterOptions, chapterCacheState, startJobPolling, onStateChange]);

  const cancelChapterJob = useCallback(async () => {
    const jobId = chapterJob?.job_id;
    if (!jobId) return null;
    const job = await cancelTtsJob(jobId);
    setChapterJob(job);
    setChapterGenerating(false);
    const updates: Partial<TtsState> = {
      chapterJob: job,
      chapterGenerating: false,
    };
    if (job.error) {
      updates.error = job.error.message;
      updates.errorCode = job.error.code;
    }
    onStateChange(updates);
    if (jobPollRef.current) {
      window.clearInterval(jobPollRef.current);
      jobPollRef.current = null;
    }
    return job;
  }, [chapterJob?.job_id, onStateChange]);

  const retryChapterJob = useCallback(async () => {
    const jobId = chapterJob?.job_id;
    if (!jobId) return null;
    const job = await retryTtsJob(jobId);
    setChapterJob(job);
    setChapterGenerating(['queued', 'running'].includes(job.status));
    onStateChange({
      chapterJob: job,
      chapterGenerating: ['queued', 'running'].includes(job.status),
      error: null,
      errorCode: null,
    });
    if (['queued', 'running'].includes(job.status)) {
      startJobPolling(job.job_id);
    }
    return job;
  }, [chapterJob?.job_id, startJobPolling, onStateChange]);

  return {
    chapterAudio,
    chapterLoading,
    chapterGenerating,
    chapterJob,
    chapterCacheState,
    downloadUrl,
    loadChapterAudio,
    generateChapter,
    cancelChapterJob,
    retryChapterJob,
  };
}
