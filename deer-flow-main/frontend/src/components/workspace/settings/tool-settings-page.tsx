"use client";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useEnableFeatureFlag, useFeatureFlags } from "@/core/features/hooks";
import type { FeatureFlagState } from "@/core/features/type";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig, useEnableMCPServer } from "@/core/mcp/hooks";
import type { MCPServerConfig } from "@/core/mcp/types";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

export function ToolSettingsPage() {
  const { t } = useI18n();
  const { config, isLoading, error } = useMCPConfig();
  const {
    config: featureConfig,
    isLoading: isFeaturesLoading,
    error: featureError,
  } = useFeatureFlags();
  const resolvedFeatureFlags =
    featureConfig &&
    featureConfig.features &&
    typeof featureConfig.features === "object"
      ? featureConfig.features
      : null;
  const features =
    resolvedFeatureFlags && Object.keys(resolvedFeatureFlags).length > 0
      ? resolvedFeatureFlags
      : {
          intent_recognition: { enabled: true },
        };

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      <div className="flex w-full flex-col gap-4">
        {isLoading ? (
          <div className="text-muted-foreground text-sm">{t.common.loading}</div>
        ) : error ? (
          <div>Error: {error.message}</div>
        ) : (
          config && <MCPServerList servers={config.mcp_servers} />
        )}

        <div className="mt-2">
          <div className="mb-2 text-sm font-medium">Feature Flags</div>
          {isFeaturesLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : featureError ? (
            <div>Error: {featureError.message}</div>
          ) : (
            <FeatureFlagList features={features} />
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function MCPServerList({
  servers,
}: {
  servers: Record<string, MCPServerConfig>;
}) {
  const { mutate: enableMCPServer } = useEnableMCPServer();
  return (
    <div className="flex w-full flex-col gap-4">
      {Object.entries(servers).map(([name, config]) => (
        <Item className="w-full" variant="outline" key={name}>
          <ItemContent>
            <ItemTitle>
              <div className="flex items-center gap-2">
                <div>{name}</div>
              </div>
            </ItemTitle>
            <ItemDescription className="line-clamp-4">
              {config.description}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={config.enabled}
              disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
              onCheckedChange={(checked) =>
                enableMCPServer({ serverName: name, enabled: checked })
              }
            />
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}

function FeatureFlagList({
  features,
}: {
  features: Record<string, FeatureFlagState>;
}) {
  const { mutate: enableFeatureFlag } = useEnableFeatureFlag();
  return (
    <div className="flex w-full flex-col gap-4">
      {Object.entries(features).map(([name, config]) => (
        <Item className="w-full" variant="outline" key={name}>
          <ItemContent>
            <ItemTitle>{name}</ItemTitle>
            <ItemDescription>Enable or disable this runtime feature.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={config.enabled}
              disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
              onCheckedChange={(checked) =>
                enableFeatureFlag({ featureName: name, enabled: checked })
              }
            />
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}
