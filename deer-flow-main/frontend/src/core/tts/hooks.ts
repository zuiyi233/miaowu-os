'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { synthesizeSpeech } from './api';
import { NativeSpeechController, getNativeVoices, isNativeSpeechSupported, subscribeNativeVoicesChanged } from './nativeSpeech';
import { INITIAL_STATE, type TtsPlaybackEngine, type TtsState, type UseTtsOptions } from './tts-state';
import { useTtsBrowserExport } from './use-tts-browser-export';
import { useTtsChapterAudio } from './use-tts-chapter-audio';
import { useTtsConfig } from './use-tts-config';
import { useTtsNarrationPlan } from './use-tts-narration-plan';
import { cleanupAudio } from './utils/audio-cleanup';

export type { TtsPlaybackEngine, TtsState, UseTtsOptions } from './tts-state';

export function useTts(options: UseTtsOptions = {}) {
  const [state, setState] = useState<TtsState>({
    ...INITIAL_STATE,
    playbackEngine: options.playbackEngine ?? INITIAL_STATE.playbackEngine,
    nativeVoiceId: options.nativeVoiceId,
    nativeRate: options.nativeRate ?? INITIAL_STATE.nativeRate,
    nativePitch: options.nativePitch ?? INITIAL_STATE.nativePitch,
    narrationMode: options.narrationMode ?? INITIAL_STATE.narrationMode,
    speakerVoices: options.speakerVoices ?? INITIAL_STATE.speakerVoices,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const synthesisAbortRef = useRef<AbortController | null>(null);
  const nativeControllerRef = useRef<NativeSpeechController | null>(null);
  const durationTimerRef = useRef<number | null>(null);

  const applyState = useCallback((updates: Partial<TtsState>) => {
    setState((current) => ({ ...current, ...updates }));
  }, []);

  const config = useTtsConfig(options, applyState);
  const narrationPlan = useTtsNarrationPlan(
    {
      narrationMode: options.narrationMode,
      speakerVoices: options.speakerVoices,
    },
    {
      selectedProvider: config.selectedProvider,
      selectedVoice: config.selectedVoice,
      selectedModel: config.selectedModel,
      selectedFormat: config.selectedFormat,
      selectedSpeed: config.selectedSpeed,
      instructions: config.instructions,
      advancedOptions: config.advancedOptions,
    },
    applyState,
  );
  const chapterAudio = useTtsChapterAudio(
    {
      selectedProvider: config.selectedProvider,
      selectedVoice: config.selectedVoice,
      selectedModel: config.selectedModel,
      selectedFormat: config.selectedFormat,
      selectedSpeed: config.selectedSpeed,
      instructions: config.instructions,
      advancedOptions: config.advancedOptions,
      narrationMode: narrationPlan.narrationMode,
      speakerVoices: narrationPlan.speakerVoices,
    },
    {
      narrationPlan: narrationPlan.narrationPlan,
    },
    applyState,
  );
  const browserExport = useTtsBrowserExport(chapterAudio.chapterAudio, applyState);

  const cleanupCurrentAudio = useCallback(() => {
    cleanupAudio(audioRef.current, objectUrlRef.current);
    audioRef.current = null;
    objectUrlRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const setNativeVoices = useCallback(() => {
    const nativeVoices = getNativeVoices();
    applyState({
      nativeSupported: isNativeSpeechSupported(),
      nativeVoices,
      nativeVoiceId: state.nativeVoiceId ?? options.nativeVoiceId ?? nativeVoices.find((voice) => voice.default)?.id ?? nativeVoices[0]?.id,
    });
  }, [applyState, options.nativeVoiceId, state.nativeVoiceId]);

  useEffect(() => {
    if (!nativeControllerRef.current) {
      nativeControllerRef.current = new NativeSpeechController();
    }
    setNativeVoices();
    return subscribeNativeVoicesChanged(setNativeVoices);
  }, [setNativeVoices]);

  useEffect(() => () => {
    synthesisAbortRef.current?.abort();
    nativeControllerRef.current?.stop();
    stopTimer();
    cleanupCurrentAudio();
  }, [cleanupCurrentAudio, stopTimer]);

  const resetPlaybackPosition = useCallback(() => {
    stopTimer();
    applyState({
      playing: false,
      loading: false,
      progress: 0,
      duration: 0,
      currentTime: 0,
    });
  }, [applyState, stopTimer]);

  const updateAudioProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    applyState({
      currentTime,
      duration,
      progress: duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0,
    });
  }, [applyState]);

  const playBlob = useCallback((blob: Blob) => {
    cleanupCurrentAudio();
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(blob);
    objectUrlRef.current = objectUrl;
    audioRef.current = audio;
    audio.src = objectUrl;
    audio.onloadedmetadata = updateAudioProgress;
    audio.ontimeupdate = updateAudioProgress;
    audio.onended = resetPlaybackPosition;
    audio.onerror = () => {
      stopTimer();
      applyState({
        playing: false,
        loading: false,
        error: 'Audio playback failed',
        errorCode: 'playback',
      });
    };
    return audio.play().then(() => {
      applyState({ playing: true, loading: false, error: null, errorCode: null });
      stopTimer();
      durationTimerRef.current = window.setInterval(updateAudioProgress, 500);
    });
  }, [applyState, cleanupCurrentAudio, resetPlaybackPosition, stopTimer, updateAudioProgress]);

  const speakWithNative = useCallback((text: string) => {
    const controller = nativeControllerRef.current ?? new NativeSpeechController();
    nativeControllerRef.current = controller;
    const chunks = text.trim().length > 0 ? text.trim().length : 0;
    if (!controller.supported || chunks === 0) {
      applyState({
        error: 'Native speech synthesis is not supported by this browser',
        errorCode: 'unsupported_provider',
      });
      return;
    }
    const started = controller.speak(text, {
      voiceId: state.nativeVoiceId,
      rate: state.nativeRate,
      pitch: state.nativePitch,
      onStart: () => applyState({ playing: true, loading: false, error: null, errorCode: null }),
      onBoundary: (index, total) => applyState({
        progress: total > 0 ? Math.min(100, Math.max(0, (index / total) * 100)) : 0,
        currentTime: index,
        duration: total,
      }),
      onEnd: resetPlaybackPosition,
      onError: (message) => applyState({
        playing: false,
        loading: false,
        error: message,
        errorCode: 'playback',
      }),
    });
    if (!started) resetPlaybackPosition();
  }, [applyState, resetPlaybackPosition, state.nativePitch, state.nativeRate, state.nativeVoiceId]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    synthesisAbortRef.current?.abort();
    if (state.playbackEngine === 'device') {
      speakWithNative(text);
      return;
    }

    const controller = new AbortController();
    synthesisAbortRef.current = controller;
    applyState({ loading: true, error: null, errorCode: null });
    try {
      const blob = await synthesizeSpeech({
        text,
        provider: config.selectedProvider,
        voice: config.selectedVoice,
        model: config.selectedModel,
        fmt: config.selectedFormat,
        speed: config.selectedSpeed,
        instructions: config.instructions,
        advanced_options: config.advancedOptions,
        signal: controller.signal,
      });
      await playBlob(blob);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      applyState({
        playing: false,
        loading: false,
        error: error instanceof Error ? error.message : 'TTS synthesis failed',
        errorCode: 'synthesis',
      });
    }
  }, [
    applyState,
    config.advancedOptions,
    config.instructions,
    config.selectedFormat,
    config.selectedModel,
    config.selectedProvider,
    config.selectedSpeed,
    config.selectedVoice,
    playBlob,
    speakWithNative,
    state.playbackEngine,
  ]);

  const pause = useCallback(() => {
    if (state.playbackEngine === 'device') {
      nativeControllerRef.current?.pause();
    } else {
      audioRef.current?.pause();
    }
    applyState({ playing: false });
  }, [applyState, state.playbackEngine]);

  const resume = useCallback(() => {
    if (state.playbackEngine === 'device') {
      nativeControllerRef.current?.resume();
      applyState({ playing: true });
      return;
    }
    void audioRef.current?.play().then(() => applyState({ playing: true })).catch((error: unknown) => {
      applyState({
        error: error instanceof Error ? error.message : 'Audio playback blocked',
        errorCode: 'autoplay_blocked',
      });
    });
  }, [applyState, state.playbackEngine]);

  const stop = useCallback(() => {
    synthesisAbortRef.current?.abort();
    nativeControllerRef.current?.stop();
    cleanupCurrentAudio();
    resetPlaybackPosition();
  }, [cleanupCurrentAudio, resetPlaybackPosition]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
    updateAudioProgress();
  }, [updateAudioProgress]);

  const clearError = useCallback(() => {
    applyState({ error: null, errorCode: null });
  }, [applyState]);

  const setPlaybackEngine = useCallback((playbackEngine: TtsPlaybackEngine) => {
    stop();
    applyState({ playbackEngine });
  }, [applyState, stop]);

  const setNativeVoiceId = useCallback((nativeVoiceId: string | undefined) => {
    applyState({ nativeVoiceId });
  }, [applyState]);

  const setNativeRate = useCallback((nativeRate: number) => {
    applyState({ nativeRate });
  }, [applyState]);

  const setNativePitch = useCallback((nativePitch: number) => {
    applyState({ nativePitch });
  }, [applyState]);

  return {
    ...state,
    ...config,
    status: config.providerStatus,
    smoke: config.providerSmoke,
    providerError: config.providerError,
    selectedModel: config.selectedModel,
    selectedFormat: config.selectedFormat,
    selectedSpeed: config.selectedSpeed,
    instructions: config.instructions,
    advancedOptions: config.advancedOptions,
    ...narrationPlan,
    ...chapterAudio,
    ...browserExport,
    speak,
    pause,
    resume,
    stop,
    seek,
    clearError,
    setPlaybackEngine,
    setNativeVoiceId,
    setNativeRate,
    setNativePitch,
  };
}
