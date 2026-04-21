export interface FeatureFlagState {
  enabled: boolean;
}

export interface FeatureFlagsConfig {
  features: Record<string, FeatureFlagState>;
}
