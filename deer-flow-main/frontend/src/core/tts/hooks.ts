'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchTtsConfig, fetchTtsVoices, synthesizeSpeech, type TtsConfig, type TtsProvider, type TtsVoiceInfo } from './api';

export interface UseTtsOptions {
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  speed?: number;
}

export interface TtsState {
  playing: boolean;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  progress: number;
  duration: number;
  currentTime: number;
}

const INITIAL_STATE: TtsState = {
  playing: false,
  loading: false,
  error: null,
  errorCode: null,
  progress: 0,
  duration: 0,
  currentTime: 0,
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

export function useTts(options: UseTtsOptions = {}) {
  const [state, setState] = useState<TtsState>(INITIAL_STATE);
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<TtsProvider>(options.provider ?? 'openai');
  const [selectedVoice, setSelectedVoice] = useState<string | undefined>(options.voice);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speakSeqRef = useRef(0);

  const setError = useCallback((message: string, errorCode: string) => {
    setState((s) => ({ ...s, error: message, errorCode }));
  }, []);

  useEffect(() => {
    fetchTtsConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (!options.provider && cfg.default_provider) {
          setSelectedProvider(cfg.default_provider);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load TTS config';
        setState((s) => (s.error ? s : { ...s, error: message, errorCode: 'load_config' }));
      });
  }, [options.provider]);

  useEffect(() => {
    fetchTtsVoices(selectedProvider)
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
  }, [selectedProvider]);

  useEffect(() => {
    return () => {
      _cleanupAudio(audioRef.current, blobUrlRef.current);
      audioRef.current = null;
      blobUrlRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    _cleanupAudio(audioRef.current, blobUrlRef.current);
    audioRef.current = null;
    blobUrlRef.current = null;
    abortRef.current?.abort();
    setState({ playing: false, loading: false, error: null, errorCode: null, progress: 0, currentTime: 0, duration: 0 });
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null, errorCode: null }));
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    _cleanupAudio(audioRef.current, blobUrlRef.current);
    audioRef.current = null;
    blobUrlRef.current = null;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const seq = ++speakSeqRef.current;

    setState({ playing: false, loading: true, error: null, errorCode: null, progress: 0, currentTime: 0, duration: 0 });

    try {
      const blob = await synthesizeSpeech({
        text,
        provider: selectedProvider,
        voice: selectedVoice,
        model: options.model,
        speed: options.speed,
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
        setState({ playing: false, loading: false, error: 'Audio playback error', errorCode: 'playback', progress: 0, currentTime: 0, duration: 0 });
      });

      await audio.play();
      if (seq !== speakSeqRef.current) return;
      setState((s) => ({ ...s, playing: true, loading: false }));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (seq !== speakSeqRef.current) return;
      const message = err instanceof Error ? err.message : 'TTS synthesis failed';
      setState({ playing: false, loading: false, error: message, errorCode: 'synthesis', progress: 0, currentTime: 0, duration: 0 });
    }
  }, [selectedProvider, selectedVoice, options.model, options.speed]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setState((s) => ({ ...s, playing: false }));
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch((err: DOMException) => {
        if (err.name === 'NotAllowedError') {
          setError('浏览器阻止了自动播放，请手动点击播放', 'autoplay_blocked');
        }
      });
      setState((s) => ({ ...s, playing: true }));
    }
  }, [setError]);

  const seek = useCallback((fraction: number) => {
    if (audioRef.current?.duration) {
      audioRef.current.currentTime = fraction * audioRef.current.duration;
    }
  }, []);

  return {
    ...state,
    config,
    voices,
    selectedProvider,
    selectedVoice,
    setSelectedProvider,
    setSelectedVoice,
    speak,
    pause,
    resume,
    stop,
    seek,
    clearError,
  };
}
