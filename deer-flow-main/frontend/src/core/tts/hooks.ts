'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TtsApiError,
  synthesizeSpeech,
} from './api';
import {
  NativeSpeechController,
  getNativeVoices,
  isNativeSpeechSupported,
  subscribeNativeVoicesChanged,
} from './nativeSpeech';
import { INITIAL_STATE, type TtsPlaybackEngine, type TtsState, type UseTtsOptions } from './tts-state';
import { useTtsBrowserExport } from './use-tts-browser-export';
import { useTtsChapterAudio } from './use-tts-chapter-audio';
import { useTtsConfig } from './use-tts-config';
import { useTtsNarrationPlan } from './use-tts-narration-plan';
import { cleanupAudio } from './utils/audio-cleanup';
import { buildProviderRuntimeState } from './utils/provider-helpers';

export type { TtsPlaybackEngine, TtsState, UseTtsOptions } from './tts-state';

export function useTts(options: UseTtsOptions = {}) {
  const [state, setState] = useState<TtsState>(INITIAL_STATE);
  const [playbackEngine, setPlaybackEngineState] = useState<TtsPlaybackEngine>(options.playbackEngine ?? 'device');
  const [nativeVoiceId, setNativeVoiceId] = useState<string | undefined>(options.nativeVoiceId);
  const [nativeRate, setNativeRate] = useState<number>(options.nativeRate ?? 1);
  const [nativePitch, setNativePitch] = useState<number>(options.nativePitch ?? 1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeSpeechRef = useRef<NativeSpeechController | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speakSeqRef = useRef(0);

  const onStateChange = useCallback((updates: Partial<TtsState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const configHook = useTtsConfig(
    {
      provider: options.provider,
      voice: options.voice,
      model: options.model,
      fmt: options.fmt,
      speed: options.speed,
      instructions: options.instructions,
      advancedOptions: options.advancedOptions,
    },
    onStateChange,
  );

  const narrationPlanHook = useTtsNarrationPlan(
    {
      narrationMode: options.narrationMode,
      speakerVoices: options.speakerVoices,
    },
    {
      selectedProvider: configHook.selectedProvider,
      selectedVoice: configHook.selectedVoice,
      selectedModel: configHook.selectedModel,
      selectedFormat: configHook.selectedFormat,
      selectedSpeed: configHook.selectedSpeed,
      instructions: configHook.instructions,
      advancedOptions: configHook.advancedOptions,
    },
    onStateChange,
  );

  const chapterAudioHook = useTtsChapterAudio(
    {
      selectedProvider: configHook.selectedProvider,
      selectedVoice: configHook.selectedVoice,
      selectedModel: configHook.selectedModel,
      selectedFormat: configHook.selectedFormat,
      selectedSpeed: configHook.selectedSpeed,
      instructions: configHook.instructions,
      advancedOptions: configHook.advancedOptions,
      narrationMode: narrationPlanHook.narrationMode,
      speakerVoices: narrationPlanHook.speakerVoices,
    },
    {
      narrationPlan: narrationPlanHook.narrationPlan,
    },
    onStateChange,
  );

  const browserExportHook = useTtsBrowserExport(
    chapterAudioHook.chapterAudio,
    onStateChange,
  );

  const setError = useCallback((message: string, errorCode: string) => {
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
  }, [nativeVoiceId, playbackEngine]);

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
    return () => {
      cleanupAudio(audioRef.current, blobUrlRef.current);
      nativeSpeechRef.current?.stop();
      audioRef.current = null;
      blobUrlRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    cleanupAudio(audioRef.current, blobUrlRef.current);
    nativeSpeechRef.current?.stop();
    audioRef.current = null;
    blobUrlRef.current = null;
    abortRef.current?.abort();
    setState({
      ...INITIAL_STATE,
      ...buildProviderRuntimeState(configHook.config, configHook.selectedProvider),
      playbackEngine,
      nativeSupported: isNativeSpeechSupported(),
      nativeVoices: getNativeVoices(),
      nativeVoiceId,
      nativeRate,
      nativePitch,
      browserExportSupported: typeof window !== 'undefined' && typeof WebAssembly !== 'undefined',
    });
  }, [configHook.config, configHook.selectedProvider, nativePitch, nativeRate, nativeVoiceId, playbackEngine]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null, errorCode: null }));
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    cleanupAudio(audioRef.current, blobUrlRef.current);
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
        provider: configHook.selectedProvider,
        voice: configHook.selectedVoice,
        model: configHook.selectedModel,
        fmt: configHook.selectedFormat,
        speed: configHook.selectedSpeed,
        instructions: configHook.instructions,
        advanced_options: configHook.advancedOptions,
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
          ...buildProviderRuntimeState(configHook.config, configHook.selectedProvider),
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
        ...buildProviderRuntimeState(configHook.config, configHook.selectedProvider),
      }));
    }
  }, [
    configHook.advancedOptions,
    configHook.config,
    configHook.instructions,
    configHook.selectedFormat,
    configHook.selectedModel,
    configHook.selectedProvider,
    configHook.selectedSpeed,
    configHook.selectedVoice,
    nativePitch,
    nativeRate,
    nativeVoiceId,
    playbackEngine,
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
      audioRef.current.play()
        .then(() => {
          setState((s) => ({ ...s, playing: true }));
        })
        .catch((err: DOMException) => {
          setState((s) => ({ ...s, playing: false }));
          if (err.name === 'NotAllowedError') {
            setError('浏览器阻止了自动播放，请手动点击播放', 'autoplay_blocked');
          }
        });
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

  return {
    ...state,
    config: configHook.config,
    voices: configHook.voices,
    selectedProvider: configHook.selectedProvider,
    selectedVoice: configHook.selectedVoice,
    selectedModel: configHook.selectedModel,
    selectedFormat: configHook.selectedFormat,
    selectedSpeed: configHook.selectedSpeed,
    instructions: configHook.instructions,
    advancedOptions: configHook.advancedOptions,
    capabilities: configHook.capabilities,
    setSelectedProvider: configHook.setSelectedProvider,
    setSelectedVoice: configHook.setSelectedVoice,
    setSelectedModel: configHook.setSelectedModel,
    setSelectedFormat: configHook.setSelectedFormat,
    setSelectedSpeed: configHook.setSelectedSpeed,
    setInstructions: configHook.setInstructions,
    setAdvancedOptions: configHook.setAdvancedOptions,
    playbackEngine: state.playbackEngine,
    setPlaybackEngine,
    nativeSupported: state.nativeSupported,
    nativeVoices: state.nativeVoices,
    nativeVoiceId: state.nativeVoiceId ?? nativeVoiceId,
    nativeRate,
    nativePitch,
    setNativeVoiceId,
    setNativeRate,
    setNativePitch,
    browserExporting: browserExportHook.browserExporting,
    browserExportSupported: browserExportHook.browserExportSupported,
    browserExportAvailable: browserExportHook.browserExportAvailable,
    exportChapterInBrowser: browserExportHook.exportChapterInBrowser,
    narrationMode: narrationPlanHook.narrationMode,
    narrationPlan: narrationPlanHook.narrationPlan ?? null,
    narrationPlanLoading: narrationPlanHook.narrationPlanLoading ?? false,
    narrationPlanGenerating: narrationPlanHook.narrationPlanGenerating ?? false,
    speakerVoices: narrationPlanHook.speakerVoices ?? {},
    setNarrationMode: narrationPlanHook.setNarrationMode,
    setSpeakerVoices: narrationPlanHook.setSpeakerVoices,
    loadNarrationPlan: narrationPlanHook.loadNarrationPlan,
    generatePlan: narrationPlanHook.generatePlan,
    savePlan: narrationPlanHook.savePlan,
    chapterAudio: chapterAudioHook.chapterAudio ?? state.chapterAudio,
    chapterLoading: chapterAudioHook.chapterLoading ?? state.chapterLoading,
    chapterGenerating: chapterAudioHook.chapterGenerating ?? state.chapterGenerating,
    chapterJob: chapterAudioHook.chapterJob ?? state.chapterJob,
    chapterCacheState: chapterAudioHook.chapterCacheState ?? state.chapterCacheState,
    downloadUrl: chapterAudioHook.downloadUrl ?? state.downloadUrl,
    loadChapterAudio: chapterAudioHook.loadChapterAudio,
    generateChapter: chapterAudioHook.generateChapter,
    cancelChapterJob: chapterAudioHook.cancelChapterJob,
    retryChapterJob: chapterAudioHook.retryChapterJob,
    speak,
    pause,
    resume,
    stop,
    seek,
    clearError,
  };
}
