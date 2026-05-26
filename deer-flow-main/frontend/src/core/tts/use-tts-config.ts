'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  fetchTtsConfig,
  fetchTtsVoices,
  type TtsAdvancedOptions,
  type TtsConfig,
  type TtsProvider,
  type TtsProviderCapabilities,
  type TtsProviderError,
  type TtsProviderStatus,
  type TtsVoiceInfo,
} from './api';
import type { TtsState } from './tts-state';
import {
  buildProviderRuntimeState,
  getProviderCapabilities,
  getProviderDefaultFormat,
  getProviderDefaultModel,
  getProviderDefaultSpeed,
} from './utils/provider-helpers';

export interface UseTtsConfigOptions {
  provider?: TtsProvider;
  voice?: string;
  model?: string;
  fmt?: string;
  speed?: number;
  instructions?: string;
  advancedOptions?: TtsAdvancedOptions;
}

export interface UseTtsConfigReturn {
  config: TtsConfig | null;
  selectedProvider: TtsProvider;
  selectedVoice: string | undefined;
  selectedModel: string | undefined;
  selectedFormat: string | undefined;
  selectedSpeed: number | undefined;
  instructions: string | undefined;
  advancedOptions: TtsAdvancedOptions | undefined;
  voices: TtsVoiceInfo[];
  capabilities: TtsProviderCapabilities | null;
  providerStatus: TtsProviderStatus | null;
  providerSmoke: TtsProviderStatus | null;
  providerError: TtsProviderError | null;
  setSelectedProvider: React.Dispatch<React.SetStateAction<TtsProvider>>;
  setSelectedVoice: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedFormat: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedSpeed: React.Dispatch<React.SetStateAction<number | undefined>>;
  setInstructions: React.Dispatch<React.SetStateAction<string | undefined>>;
  setAdvancedOptions: React.Dispatch<React.SetStateAction<TtsAdvancedOptions | undefined>>;
}

export function useTtsConfig(
  options: UseTtsConfigOptions,
  onStateChange: (updates: Partial<TtsState>) => void,
): UseTtsConfigReturn {
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<TtsProvider>(options.provider ?? 'openai');
  const [selectedVoice, setSelectedVoice] = useState<string | undefined>(options.voice);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(options.model);
  const [selectedFormat, setSelectedFormat] = useState<string | undefined>(options.fmt);
  const [selectedSpeed, setSelectedSpeed] = useState<number | undefined>(options.speed);
  const [instructions, setInstructions] = useState<string | undefined>(options.instructions);
  const [advancedOptions, setAdvancedOptions] = useState<TtsAdvancedOptions | undefined>(options.advancedOptions);

  const [providerRuntimeState, setProviderRuntimeState] = useState<{
    status: TtsProviderStatus | null;
    smoke: TtsProviderStatus | null;
    providerError: TtsProviderError | null;
  }>({ status: null, smoke: null, providerError: null });

  const syncProviderRuntimeState = useCallback((cfg: TtsConfig | null, provider: TtsProvider) => {
    const runtimeState = buildProviderRuntimeState(cfg, provider);
    setProviderRuntimeState(runtimeState);
    onStateChange(runtimeState);
  }, [onStateChange]);

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
        syncProviderRuntimeState(cfg, provider);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load TTS config';
        onStateChange({ error: message, errorCode: 'load_config' });
      });
  }, [options.fmt, options.model, options.provider, options.speed, syncProviderRuntimeState, onStateChange]);

  useEffect(() => {
    syncProviderRuntimeState(config, selectedProvider);
    setSelectedModel(getProviderDefaultModel(config, selectedProvider));
    setSelectedFormat(getProviderDefaultFormat(config, selectedProvider));
    setSelectedSpeed(getProviderDefaultSpeed(config, selectedProvider));
  }, [config, selectedProvider, syncProviderRuntimeState]);

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
        onStateChange({ error: message, errorCode: 'load_voices' });
      });
  }, [selectedModel, selectedProvider, onStateChange]);

  const capabilities = getProviderCapabilities(config, selectedProvider);

  return {
    config,
    selectedProvider,
    selectedVoice,
    selectedModel,
    selectedFormat,
    selectedSpeed,
    instructions,
    advancedOptions,
    voices,
    capabilities,
    providerStatus: providerRuntimeState.status,
    providerSmoke: providerRuntimeState.smoke,
    providerError: providerRuntimeState.providerError,
    setSelectedProvider,
    setSelectedVoice,
    setSelectedModel,
    setSelectedFormat,
    setSelectedSpeed,
    setInstructions,
    setAdvancedOptions,
  };
}
