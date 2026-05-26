'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TtsApiError,
  generateNarrationPlan,
  getNarrationPlan,
  saveNarrationPlan,
  type TtsAdvancedOptions,
  type TtsNarrationMode,
  type TtsNarrationPlan,
  type TtsNarrationPlanRequestOptions,
  type TtsProvider,
  type TtsSpeakerVoiceMapping,
} from './api';
import type { TtsState } from './tts-state';

export interface UseTtsNarrationPlanReturn {
  narrationMode: TtsNarrationMode;
  narrationPlan: TtsNarrationPlan | null;
  narrationPlanLoading: boolean;
  narrationPlanGenerating: boolean;
  speakerVoices: TtsSpeakerVoiceMapping;
  loadNarrationPlan: (chapterId: string, overrides?: Partial<TtsNarrationPlanRequestOptions>) => Promise<TtsNarrationPlan | null>;
  generatePlan: (chapterId: string, text: string, overrides?: Partial<TtsNarrationPlanRequestOptions>) => Promise<TtsNarrationPlan | null>;
  savePlan: (chapterId: string, plan: TtsNarrationPlan, overrides?: Partial<TtsNarrationPlanRequestOptions>) => Promise<TtsNarrationPlan | null>;
  setNarrationMode: (mode: TtsNarrationMode) => void;
  setSpeakerVoices: (voices: TtsSpeakerVoiceMapping) => void;
}

function abortControllerRef(ref: { current: AbortController | null }): void {
  if (typeof ref.current?.abort === 'function') {
    ref.current.abort();
  }
  ref.current = null;
}

export function useTtsNarrationPlan(
  options: {
    narrationMode?: TtsNarrationMode;
    speakerVoices?: TtsSpeakerVoiceMapping;
  },
  configDeps: {
    selectedProvider: TtsProvider;
    selectedVoice: string | undefined;
    selectedModel: string | undefined;
    selectedFormat: string | undefined;
    selectedSpeed: number | undefined;
    instructions: string | undefined;
    advancedOptions: TtsAdvancedOptions | undefined;
  },
  onStateChange: (updates: Partial<TtsState>) => void,
): UseTtsNarrationPlanReturn {
  const [narrationMode, setNarrationMode] = useState<TtsNarrationMode>(options.narrationMode ?? 'single_narrator');
  const [speakerVoices, setSpeakerVoices] = useState<TtsSpeakerVoiceMapping>(options.speakerVoices ?? {});
  const [narrationPlan, setNarrationPlan] = useState<TtsNarrationPlan | null>(null);
  const [narrationPlanLoading, setNarrationPlanLoading] = useState(false);
  const [narrationPlanGenerating, setNarrationPlanGenerating] = useState(false);

  const narrationPlanLoadAbortRef = useRef<AbortController | null>(null);
  const narrationPlanGenerateAbortRef = useRef<AbortController | null>(null);
  const narrationPlanSaveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortControllerRef(narrationPlanLoadAbortRef);
    abortControllerRef(narrationPlanGenerateAbortRef);
    abortControllerRef(narrationPlanSaveAbortRef);
  }, []);

  const buildNarrationPlanOptions = useCallback((
    chapterId: string,
    text: string | undefined,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ): TtsNarrationPlanRequestOptions => ({
    chapter_id: chapterId,
    text: overrides.text ?? text,
    provider: overrides.provider ?? configDeps.selectedProvider,
    voice: overrides.voice ?? configDeps.selectedVoice,
    model: overrides.model ?? configDeps.selectedModel,
    fmt: overrides.fmt ?? configDeps.selectedFormat,
    speed: overrides.speed ?? configDeps.selectedSpeed,
    instructions: overrides.instructions ?? configDeps.instructions,
    advanced_options: overrides.advanced_options ?? configDeps.advancedOptions,
    mode: overrides.mode ?? narrationMode,
    speaker_voices: overrides.speaker_voices ?? speakerVoices,
    project_id: overrides.project_id,
    title: overrides.title,
    plan: overrides.plan,
    signal: overrides.signal,
  }), [
    configDeps.advancedOptions,
    configDeps.instructions,
    configDeps.selectedFormat,
    configDeps.selectedModel,
    configDeps.selectedProvider,
    configDeps.selectedSpeed,
    configDeps.selectedVoice,
    narrationMode,
    speakerVoices,
  ]);

  const applyNarrationPlan = useCallback((plan: TtsNarrationPlan | null) => {
    setNarrationPlan(plan);
    const mode = plan ? 'ai_multivoice' : narrationMode;
    if (plan) {
      setNarrationMode('ai_multivoice');
    }
    onStateChange({
      narrationPlan: plan,
      narrationMode: mode,
    });
    if (plan) {
      onStateChange({
        chapterAudio: null,
        chapterCacheState: 'unknown',
        downloadUrl: null,
        browserExportAvailable: false,
      });
    }
  }, [narrationMode, onStateChange]);

  const loadNarrationPlan = useCallback(async (
    chapterId: string,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ) => {
    if (!chapterId) return null;
    abortControllerRef(narrationPlanLoadAbortRef);
    const controller = new AbortController();
    narrationPlanLoadAbortRef.current = controller;
    setNarrationPlanLoading(true);
    onStateChange({
      narrationPlanLoading: true,
      error: null,
      errorCode: null,
    });
    try {
      const plan = await getNarrationPlan(chapterId, {
        project_id: overrides.project_id,
        signal: controller.signal,
      });
      applyNarrationPlan(plan);
      setNarrationPlanLoading(false);
      onStateChange({ narrationPlanLoading: false });
      return plan;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to load narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setNarrationPlanLoading(false);
      onStateChange({
        narrationPlanLoading: false,
        error: message,
        errorCode,
      });
      return null;
    }
  }, [applyNarrationPlan, onStateChange]);

  const generatePlan = useCallback(async (
    chapterId: string,
    text: string,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ) => {
    if (!chapterId || !text.trim()) return null;
    abortControllerRef(narrationPlanGenerateAbortRef);
    const controller = new AbortController();
    narrationPlanGenerateAbortRef.current = controller;
    setNarrationPlanGenerating(true);
    onStateChange({
      narrationPlanGenerating: true,
      error: null,
      errorCode: null,
    });
    try {
      const plan = await generateNarrationPlan(buildNarrationPlanOptions(chapterId, text, {
        ...overrides,
        signal: controller.signal,
      }));
      applyNarrationPlan(plan);
      setNarrationPlanGenerating(false);
      onStateChange({ narrationPlanGenerating: false });
      return plan;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to generate narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setNarrationPlanGenerating(false);
      onStateChange({
        narrationPlanGenerating: false,
        error: message,
        errorCode,
      });
      return null;
    }
  }, [applyNarrationPlan, buildNarrationPlanOptions, onStateChange]);

  const savePlan = useCallback(async (
    chapterId: string,
    plan: TtsNarrationPlan,
    overrides: Partial<TtsNarrationPlanRequestOptions> = {},
  ) => {
    if (!chapterId) return null;
    abortControllerRef(narrationPlanSaveAbortRef);
    const controller = new AbortController();
    narrationPlanSaveAbortRef.current = controller;
    setNarrationPlanLoading(true);
    onStateChange({
      narrationPlanLoading: true,
      error: null,
      errorCode: null,
    });
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
      setNarrationPlanLoading(false);
      onStateChange({ narrationPlanLoading: false });
      return saved;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      const message = err instanceof Error ? err.message : 'Failed to save narration plan';
      const errorCode = err instanceof TtsApiError ? err.code : 'synthesis';
      setNarrationPlanLoading(false);
      onStateChange({
        narrationPlanLoading: false,
        error: message,
        errorCode,
      });
      return null;
    }
  }, [applyNarrationPlan, buildNarrationPlanOptions, onStateChange]);

  const updateNarrationMode = useCallback((mode: TtsNarrationMode) => {
    setNarrationMode(mode);
    onStateChange({ narrationMode: mode });
    onStateChange({
      chapterAudio: null,
      chapterCacheState: 'unknown',
      downloadUrl: null,
      browserExportAvailable: false,
    });
  }, [onStateChange]);

  const updateSpeakerVoices = useCallback((voices: TtsSpeakerVoiceMapping) => {
    setSpeakerVoices(voices);
    onStateChange({ speakerVoices: voices });
    onStateChange({
      chapterAudio: null,
      chapterCacheState: 'unknown',
      downloadUrl: null,
      browserExportAvailable: false,
    });
  }, [onStateChange]);

  return {
    narrationMode,
    narrationPlan,
    narrationPlanLoading,
    narrationPlanGenerating,
    speakerVoices,
    loadNarrationPlan,
    generatePlan,
    savePlan,
    setNarrationMode: updateNarrationMode,
    setSpeakerVoices: updateSpeakerVoices,
  };
}
