import { Check, ChevronDown, Clock, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import {
  getProviderDisplayName,
  type AiModelTarget,
} from "@/core/ai/feature-routing";
import { cn } from "@/lib/utils";

import { getCapabilityBadge, getModelCapabilities } from "../utils/model-capabilities";
import { loadRecentModels, saveRecentModel } from "../utils/recent-models-storage";

import { HelpTip } from "./help-tip";

const NONE_VALUE = "__none__";

export interface SearchableModelSelectorProps {
  label: string;
  help: string;
  target: AiModelTarget | null;
  providers: AiProviderConfig[];
  allowEmpty?: boolean;
  onChange: (next: AiModelTarget | null) => void;
}

export function SearchableModelSelector({
  label,
  help,
  target,
  providers,
  allowEmpty,
  onChange,
}: SearchableModelSelectorProps) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");

  const selectedProviderId = target?.providerId ?? NONE_VALUE;
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const selectedModel =
    selectedProvider && target?.model && selectedProvider.models.includes(target.model)
      ? target.model
      : NONE_VALUE;

  const [recentModels, setRecentModels] = useState(() => loadRecentModels());

  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) return providers;
    const q = providerSearch.toLowerCase();
    return providers.filter((p) => p.name.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q));
  }, [providers, providerSearch]);

  const filteredModels = useMemo(() => {
    const models = selectedProvider?.models ?? [];
    if (!modelSearch.trim()) return models;
    const q = modelSearch.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [selectedProvider, modelSearch]);

  const recentFilteredModels = useMemo(() => {
    if (!selectedProvider || modelSearch.trim()) return [];
    return recentModels.filter((m) => selectedProvider.models.includes(m));
  }, [selectedProvider, recentModels, modelSearch]);

  const groupedModels = useMemo(() => {
    if (!selectedProvider) return {};
    const groups: Record<string, string[]> = {};
    for (const model of filteredModels) {
      const caps = getModelCapabilities(model);
      const groupKey = caps[0] ?? "other";
      groups[groupKey] ??= [];
      groups[groupKey].push(model);
    }
    return groups;
  }, [filteredModels, selectedProvider]);

  const GROUP_LABELS: Record<string, string> = {
    thinking: "推理模型",
    vision: "视觉模型",
    long_context: "长上下文",
    fast: "快速模型",
    other: "其他模型",
  };

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      setProviderOpen(false);
      setProviderSearch("");
      if (providerId === NONE_VALUE) {
        if (allowEmpty) onChange(null);
        return;
      }
      const provider = providers.find((p) => p.id === providerId);
      if (!provider || provider.models.length === 0) {
        onChange(null);
        return;
      }
      onChange({ providerId: provider.id, model: provider.models[0]! });
    },
    [allowEmpty, onChange, providers],
  );

  const handleModelSelect = useCallback(
    (modelName: string) => {
      setModelOpen(false);
      setModelSearch("");
      if (modelName === NONE_VALUE || !selectedProvider) {
        onChange(null);
        return;
      }
      saveRecentModel(modelName);
      setRecentModels(loadRecentModels());
      onChange({ providerId: selectedProvider.id, model: modelName });
    },
    [onChange, selectedProvider],
  );

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium">{label}</span>
          {help && <HelpTip text={help} />}
        </div>
      )}
      <div className="flex gap-2">
        <Popover open={providerOpen} onOpenChange={(v) => { setProviderOpen(v); if (!v) setProviderSearch(""); }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "h-9 flex-1 min-w-0 inline-flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs",
                "ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "hover:bg-accent hover:text-accent-foreground",
                !selectedProvider && "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {selectedProvider ? selectedProvider.name : "选择服务商"}
              </span>
              <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[280px]" align="start">
            <Command shouldFilter={false}>
              <div className="flex items-center border-b px-3">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  className="flex-1 h-9 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="搜索服务商..."
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                />
              </div>
              <CommandList className="max-h-[240px]">
                <CommandEmpty>未找到匹配的服务商</CommandEmpty>
                {allowEmpty && (
                  <CommandItem value={NONE_VALUE} onSelect={() => handleProviderSelect(NONE_VALUE)} className="text-muted-foreground">
                    未设置
                  </CommandItem>
                )}
                {filteredProviders.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => handleProviderSelect(p.id)}
                    disabled={p.models.length === 0}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{p.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {p.provider}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{p.models.length} 模型</span>
                      {p.id === selectedProviderId && <Check className="h-3.5 w-3.5 text-primary" />}
                    </div>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover
          open={modelOpen}
          onOpenChange={(v) => { setModelOpen(v); if (!v) setModelSearch(""); }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!selectedProvider || selectedProvider.models.length === 0}
              className={cn(
                "h-9 flex-1 min-w-0 inline-flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs",
                "ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "hover:bg-accent hover:text-accent-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50",
                (!selectedProvider || selectedModel === NONE_VALUE) && "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {selectedProvider && selectedModel !== NONE_VALUE ? selectedModel : "选择模型"}
              </span>
              <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[340px]" align="start">
            <Command shouldFilter={false}>
              <div className="flex items-center border-b px-3">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  className="flex-1 h-9 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="搜索模型..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
              </div>
              <CommandList className="max-h-[320px]">
                <CommandEmpty>未找到匹配的模型</CommandEmpty>
                {allowEmpty && (
                  <CommandItem value={NONE_VALUE} onSelect={() => handleModelSelect(NONE_VALUE)} className="text-muted-foreground">
                    未设置
                  </CommandItem>
                )}
                {recentFilteredModels.length > 0 && !modelSearch.trim() && (
                  <CommandGroup heading={
                    <div className="flex items-center gap-1 text-xs">
                      <Clock className="h-3 w-3" />
                      最近使用
                    </div>
                  }>
                    {recentFilteredModels.map((m) => (
                      <CommandItem key={`recent-${m}`} value={m} onSelect={() => handleModelSelect(m)} className="flex items-center justify-between">
                        <span className="truncate text-xs">{m}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {getModelCapabilities(m).map((cap) => {
                            const badge = getCapabilityBadge(cap);
                            return (
                              <Badge key={cap} variant="outline" className={cn("text-[8px] px-1 py-0 border-0", badge.className)}>
                                {badge.label}
                              </Badge>
                            );
                          })}
                          {m === selectedModel && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {Object.entries(groupedModels).map(([group, models]) => (
                  <CommandGroup key={group} heading={GROUP_LABELS[group] ?? group}>
                    {models.map((m) => (
                      <CommandItem key={m} value={m} onSelect={() => handleModelSelect(m)} className="flex items-center justify-between">
                        <span className="truncate text-xs">{m}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {getModelCapabilities(m).map((cap) => {
                            const badge = getCapabilityBadge(cap);
                            return (
                              <Badge key={cap} variant="outline" className={cn("text-[8px] px-1 py-0 border-0", badge.className)}>
                                {badge.label}
                              </Badge>
                            );
                          })}
                          {m === selectedModel && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function formatModelDisplay(target: AiModelTarget | null, providers: AiProviderConfig[]) {
  if (!target) return "未设置";
  return `${getProviderDisplayName(providers, target.providerId)} / ${target.model}`;
}
