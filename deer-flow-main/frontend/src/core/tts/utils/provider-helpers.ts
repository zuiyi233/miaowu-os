import {
  type TtsConfig,
  type TtsProvider,
  type TtsProviderCapabilities,
  type TtsProviderConfig,
  type TtsProviderError,
  type TtsProviderStatus,
} from '../api';

export function getProviderConfig(config: TtsConfig | null, provider: TtsProvider): TtsProviderConfig | null {
  return config?.providers?.[provider] ?? null;
}

export function getProviderCapabilities(config: TtsConfig | null, provider: TtsProvider): TtsProviderCapabilities | null {
  return getProviderConfig(config, provider)?.capabilities ?? null;
}

export function getProviderDefaultModel(config: TtsConfig | null, provider: TtsProvider): string | undefined {
  return getProviderConfig(config, provider)?.default_model ?? config?.default_model ?? undefined;
}

export function getProviderDefaultFormat(config: TtsConfig | null, provider: TtsProvider): string | undefined {
  return getProviderConfig(config, provider)?.default_format ?? config?.default_format ?? undefined;
}

export function getProviderDefaultSpeed(config: TtsConfig | null, provider: TtsProvider): number | undefined {
  return getProviderConfig(config, provider)?.default_speed ?? config?.default_speed ?? undefined;
}

export function getProviderStatus(config: TtsConfig | null, provider: TtsProvider): TtsProviderStatus | null {
  return getProviderConfig(config, provider)?.status ?? null;
}

export function getProviderSmoke(config: TtsConfig | null, provider: TtsProvider): TtsProviderStatus | null {
  return getProviderConfig(config, provider)?.smoke ?? config?.smoke ?? null;
}

export function getProviderError(config: TtsConfig | null, provider: TtsProvider): TtsProviderError | null {
  return getProviderConfig(config, provider)?.error ?? config?.error ?? null;
}

export function buildProviderRuntimeState(config: TtsConfig | null, provider: TtsProvider) {
  return {
    status: getProviderStatus(config, provider),
    smoke: getProviderSmoke(config, provider),
    providerError: getProviderError(config, provider),
  };
}
