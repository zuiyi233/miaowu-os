import type { AiProviderConfig } from "./ai-provider-store";

export type AiParallelStrategy = "compare" | "auto" | "fusion";

export type AiRouteMode = "primary" | "backup";

export type AiChannelStatus = "online" | "degraded" | "offline";

export type AiChannelBillingMode = "token" | "request" | "subscription" | "hybrid";

export type AiFeatureCategory = "workspace" | "agent" | "novel" | "custom";

export interface AiModelTarget {
  providerId: string;
  model: string;
}

export interface AiChannelMetadata {
  providerId: string;
  billingMode: AiChannelBillingMode;
  region: string;
  status: AiChannelStatus;
}

export interface AiFeatureModuleDefinition {
  id: string;
  label: string;
  description: string;
  category: AiFeatureCategory;
  runtimeReady?: boolean;
  removable?: boolean;
}

export interface AiFeatureModuleRoute {
  moduleId: string;
  moduleLabel: string;
  moduleDescription: string;
  category: AiFeatureCategory;
  runtimeReady: boolean;
  defaultTarget: AiModelTarget | null;
  primaryTarget: AiModelTarget | null;
  backupTarget: AiModelTarget | null;
  currentMode: AiRouteMode;
  autoFailover: boolean;
  parallelEnabled: boolean;
  parallelStrategy: AiParallelStrategy;
  parallelTargets: AiModelTarget[];
}

export interface AiSwitchLogEntry {
  id: string;
  moduleId: string;
  moduleLabel: string;
  fromMode: AiRouteMode;
  toMode: AiRouteMode;
  reason: string;
  switchedAt: string;
  automatic: boolean;
}

export interface AiFeatureRoutingState {
  version: number;
  defaultTarget: AiModelTarget | null;
  channels: AiChannelMetadata[];
  modules: AiFeatureModuleRoute[];
  switchLogs: AiSwitchLogEntry[];
}

export interface AiResolvedModuleTarget {
  moduleRoute: AiFeatureModuleRoute;
  target: AiModelTarget | null;
  targetMode: AiRouteMode | "default";
}

interface PersistedFeatureRoutingState {
  version?: number;
  defaultTarget?: AiModelTarget | null;
  channels?: AiChannelMetadata[];
  modules?: AiFeatureModuleRoute[];
  switchLogs?: AiSwitchLogEntry[];
}

const STORAGE_KEY = "ai-feature-routing-settings-v1";
const MAX_SWITCH_LOGS = 40;

export const BUILTIN_FEATURE_MODULES: AiFeatureModuleDefinition[] = [
  {
    id: "chat-main",
    label: "主项目对话",
    description: "工作区默认对话入口 /workspace/chats",
    category: "workspace",
    runtimeReady: true,
  },
  {
    id: "agent-chat",
    label: "智能体对话",
    description: "自定义智能体聊天 /workspace/agents/*/chats",
    category: "agent",
    runtimeReady: true,
  },
  {
    id: "novel-inspiration-wizard",
    label: "灵感模式 / AI 项目生成",
    description: "小说灵感模式与 AI 项目生成工作流",
    category: "novel",
  },
  {
    id: "novel-book-import",
    label: "拆书导入",
    description: "小说拆书导入与结构化解析 /workspace/novel/book-import",
    category: "novel",
  },
  {
    id: "novel-chapter-management",
    label: "章节管理 / 编辑",
    description: "章节管理与正文编辑流程",
    category: "novel",
  },
  {
    id: "novel-chapter-ai-edit",
    label: "章节 AI 处理",
    description: "续写、润色、扩写、精简、改写与实体提取",
    category: "novel",
    runtimeReady: true,
  },
  {
    id: "novel-chapter-analysis",
    label: "章节分析",
    description: "章节分析与诊断",
    category: "novel",
  },
  {
    id: "novel-outline",
    label: "大纲规划",
    description: "小说大纲规划与维护",
    category: "novel",
    runtimeReady: true,
  },
  {
    id: "novel-world-building",
    label: "世界观设定",
    description: "世界观设定与 AI 辅助完善",
    category: "novel",
  },
  {
    id: "novel-characters",
    label: "角色管理",
    description: "角色管理与角色生成",
    category: "novel",
  },
  {
    id: "novel-relationships-graph",
    label: "关系图谱",
    description: "角色关系概览与关系图谱分析",
    category: "novel",
  },
  {
    id: "novel-organizations",
    label: "组织管理",
    description: "组织设定与组织关系管理",
    category: "novel",
  },
  {
    id: "novel-careers",
    label: "职业体系",
    description: "职业体系管理与 AI 生成",
    category: "novel",
  },
  {
    id: "novel-foreshadows",
    label: "伏笔管理",
    description: "伏笔设计、解析与回收管理",
    category: "novel",
  },
  {
    id: "novel-writing-styles",
    label: "写作风格",
    description: "写作风格配置与风格管理",
    category: "novel",
  },
  {
    id: "novel-prompt-workshop",
    label: "Prompt 工坊",
    description: "Prompt 模板与提示词工坊",
    category: "novel",
  },
  {
    id: "novel-recommendations",
    label: "创作建议",
    description: "小说创作建议与 AI 推荐",
    category: "novel",
  },
  {
    id: "novel-quality-report",
    label: "质量报告",
    description: "一致性与质量检查报告",
    category: "novel",
  },
  {
    id: "novel-reader-workbench",
    label: "阅读工作台",
    description: "阅读、版本对比、结构联动、批注与审计",
    category: "novel",
  },
  {
    id: "novel-ai-chat",
    label: "小说 AI 对话",
    description: "小说工作台 AI 聊天与问答",
    category: "novel",
    runtimeReady: true,
  },
];

function getFirstAvailableTarget(providers: AiProviderConfig[]): AiModelTarget | null {
  const provider = providers.find((item) => item.models.length > 0);
  if (!provider) {
    return null;
  }
  return {
    providerId: provider.id,
    model: provider.models[0]!,
  };
}

function isValidTarget(
  target: AiModelTarget | null | undefined,
  providers: AiProviderConfig[]
): target is AiModelTarget {
  if (!target?.providerId || !target.model) {
    return false;
  }
  const provider = providers.find((item) => item.id === target.providerId);
  if (!provider) {
    return false;
  }
  return provider.models.includes(target.model);
}

function normalizeTarget(
  target: AiModelTarget | null | undefined,
  providers: AiProviderConfig[],
  fallback: AiModelTarget | null
): AiModelTarget | null {
  if (isValidTarget(target, providers)) {
    return target;
  }
  return fallback;
}

function defaultChannelMeta(providerId: string): AiChannelMetadata {
  return {
    providerId,
    billingMode: "token",
    region: "global",
    status: "online",
  };
}

function buildDefaultModuleRoute(
  moduleDef: AiFeatureModuleDefinition,
  providers: AiProviderConfig[],
  defaultTarget: AiModelTarget | null
): AiFeatureModuleRoute {
  const normalizedTarget = normalizeTarget(defaultTarget, providers, null);
  return {
    moduleId: moduleDef.id,
    moduleLabel: moduleDef.label,
    moduleDescription: moduleDef.description,
    category: moduleDef.category,
    runtimeReady: Boolean(moduleDef.runtimeReady),
    defaultTarget: normalizedTarget,
    primaryTarget: normalizedTarget,
    backupTarget: null,
    currentMode: "primary",
    autoFailover: true,
    parallelEnabled: false,
    parallelStrategy: "compare",
    parallelTargets: normalizedTarget ? [normalizedTarget] : [],
  };
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function normalizeModuleRoute(
  moduleRoute: AiFeatureModuleRoute,
  providers: AiProviderConfig[],
  fallbackTarget: AiModelTarget | null,
  defaultDef?: AiFeatureModuleDefinition
): AiFeatureModuleRoute {
  const moduleLabel =
    firstNonEmptyString(moduleRoute.moduleLabel, defaultDef?.label, moduleRoute.moduleId) ??
    moduleRoute.moduleId;
  const moduleDescription =
    firstNonEmptyString(moduleRoute.moduleDescription, defaultDef?.description, "自定义功能模块") ??
    "自定义功能模块";
  const category = moduleRoute.category ?? defaultDef?.category ?? "custom";
  const runtimeReady = defaultDef
    ? Boolean(defaultDef.runtimeReady)
    : moduleRoute.category === "custom"
      ? true
      : Boolean(moduleRoute.runtimeReady);

  const defaultTarget = normalizeTarget(moduleRoute.defaultTarget, providers, fallbackTarget);
  const primaryTarget = normalizeTarget(moduleRoute.primaryTarget, providers, defaultTarget);
  const backupTarget = normalizeTarget(moduleRoute.backupTarget, providers, null);

  const normalizedParallelTargets = (Array.isArray(moduleRoute.parallelTargets)
    ? moduleRoute.parallelTargets
    : []
  ).filter((target, index, array) => {
    if (!isValidTarget(target, providers)) {
      return false;
    }
    return array.findIndex((item) => item.providerId === target.providerId && item.model === target.model) === index;
  });

  const parallelTargets =
    normalizedParallelTargets.length > 0
      ? normalizedParallelTargets
      : primaryTarget
      ? [primaryTarget]
      : [];

  return {
    moduleId: moduleRoute.moduleId,
    moduleLabel,
    moduleDescription,
    category,
    runtimeReady,
    defaultTarget,
    primaryTarget,
    backupTarget,
    currentMode: moduleRoute.currentMode === "backup" ? "backup" : "primary",
    autoFailover: Boolean(moduleRoute.autoFailover),
    parallelEnabled: Boolean(moduleRoute.parallelEnabled),
    parallelStrategy:
      moduleRoute.parallelStrategy === "auto" ||
      moduleRoute.parallelStrategy === "fusion" ||
      moduleRoute.parallelStrategy === "compare"
        ? moduleRoute.parallelStrategy
        : "compare",
    parallelTargets,
  };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createDefaultFeatureRoutingState(
  providers: AiProviderConfig[]
): AiFeatureRoutingState {
  const defaultTarget = getFirstAvailableTarget(providers);
  const channels = providers.map((provider) => defaultChannelMeta(provider.id));
  const modules = BUILTIN_FEATURE_MODULES.map((moduleDef) =>
    buildDefaultModuleRoute(moduleDef, providers, defaultTarget)
  );

  return {
    version: 1,
    defaultTarget,
    channels,
    modules,
    switchLogs: [],
  };
}

export function normalizeFeatureRoutingState(
  rawState: PersistedFeatureRoutingState | AiFeatureRoutingState | null | undefined,
  providers: AiProviderConfig[]
): AiFeatureRoutingState {
  const defaultState = createDefaultFeatureRoutingState(providers);
  if (!rawState) {
    return defaultState;
  }

  const providerIds = new Set(providers.map((provider) => provider.id));
  const fallbackTarget = getFirstAvailableTarget(providers);

  const channels = providers.map((provider) => {
    const existing = Array.isArray(rawState.channels)
      ? rawState.channels.find((item) => item.providerId === provider.id)
      : undefined;

    return {
      providerId: provider.id,
      billingMode:
        existing?.billingMode === "request" ||
        existing?.billingMode === "subscription" ||
        existing?.billingMode === "hybrid" ||
        existing?.billingMode === "token"
          ? existing.billingMode
          : "token",
      region: firstNonEmptyString(existing?.region, "global") ?? "global",
      status:
        existing?.status === "degraded" ||
        existing?.status === "offline" ||
        existing?.status === "online"
          ? existing.status
          : "online",
    };
  });

  const moduleDefsById = new Map(
    BUILTIN_FEATURE_MODULES.map((moduleDef) => [moduleDef.id, moduleDef] as const)
  );

  const normalizedModules = new Map<string, AiFeatureModuleRoute>();

  if (Array.isArray(rawState.modules)) {
    for (const moduleRoute of rawState.modules) {
      if (!moduleRoute?.moduleId) {
        continue;
      }
      const defaultDef = moduleDefsById.get(moduleRoute.moduleId);
      const normalized = normalizeModuleRoute(
        moduleRoute,
        providers,
        fallbackTarget,
        defaultDef
      );
      normalizedModules.set(normalized.moduleId, normalized);
    }
  }

  for (const moduleDef of BUILTIN_FEATURE_MODULES) {
    if (!normalizedModules.has(moduleDef.id)) {
      normalizedModules.set(
        moduleDef.id,
        buildDefaultModuleRoute(moduleDef, providers, fallbackTarget)
      );
    }
  }

  const switchLogs = Array.isArray(rawState.switchLogs)
    ? rawState.switchLogs
        .filter((log) =>
          Boolean(
            log &&
              typeof log.id === "string" &&
              typeof log.moduleId === "string" &&
              typeof log.moduleLabel === "string" &&
              typeof log.reason === "string" &&
              typeof log.switchedAt === "string"
          )
        )
        .filter((log) => normalizedModules.has(log.moduleId))
        .slice(0, MAX_SWITCH_LOGS)
    : [];

  const normalizedDefaultTarget = normalizeTarget(
    rawState.defaultTarget,
    providers,
    fallbackTarget
  );

  const modules = [...normalizedModules.values()].map((moduleRoute) => {
    if (moduleRoute.category === "custom") {
      return moduleRoute;
    }

    const def = moduleDefsById.get(moduleRoute.moduleId);
    if (!def) {
      return {
        ...moduleRoute,
        category: "custom",
      };
    }

    return {
      ...moduleRoute,
      moduleLabel: def.label,
      moduleDescription: def.description,
      category: def.category,
    };
  });

  // Remove any target referencing deleted providers.
  for (const moduleRoute of modules) {
    if (moduleRoute.defaultTarget && !providerIds.has(moduleRoute.defaultTarget.providerId)) {
      moduleRoute.defaultTarget = normalizedDefaultTarget;
    }
    if (moduleRoute.primaryTarget && !providerIds.has(moduleRoute.primaryTarget.providerId)) {
      moduleRoute.primaryTarget = normalizedDefaultTarget;
    }
    if (moduleRoute.backupTarget && !providerIds.has(moduleRoute.backupTarget.providerId)) {
      moduleRoute.backupTarget = null;
    }
    moduleRoute.parallelTargets = moduleRoute.parallelTargets.filter((target) =>
      providerIds.has(target.providerId)
    );
  }

  return {
    version: 1,
    defaultTarget: normalizedDefaultTarget,
    channels,
    modules,
    switchLogs,
  };
}

export function loadFeatureRoutingState(
  providers: AiProviderConfig[]
): AiFeatureRoutingState {
  if (typeof window === "undefined") {
    return createDefaultFeatureRoutingState(providers);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createDefaultFeatureRoutingState(providers);
  }

  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return createDefaultFeatureRoutingState(providers);
  }

  return normalizeFeatureRoutingState(parsed as PersistedFeatureRoutingState, providers);
}

export function saveFeatureRoutingState(state: AiFeatureRoutingState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function buildModelTargetKey(target: AiModelTarget | null | undefined): string {
  if (!target) {
    return "";
  }
  return `${target.providerId}::${target.model}`;
}

export function createCustomModuleRoute(
  label: string,
  description: string,
  providers: AiProviderConfig[],
  fallbackTarget: AiModelTarget | null
): AiFeatureModuleRoute {
  const normalizedLabel = label.trim() || "自定义模块";
  const normalizedDescription = description.trim() || "用户自定义的业务模块";

  const moduleId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `custom-${crypto.randomUUID()}`
      : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    moduleId,
    moduleLabel: normalizedLabel,
    moduleDescription: normalizedDescription,
    category: "custom",
    runtimeReady: true,
    defaultTarget: fallbackTarget,
    primaryTarget: fallbackTarget,
    backupTarget: null,
    currentMode: "primary",
    autoFailover: true,
    parallelEnabled: false,
    parallelStrategy: "compare",
    parallelTargets: fallbackTarget ? [fallbackTarget] : [],
  };
}

export function appendSwitchLog(
  state: AiFeatureRoutingState,
  payload: Omit<AiSwitchLogEntry, "id" | "switchedAt">
): AiFeatureRoutingState {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `switch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const log: AiSwitchLogEntry = {
    id,
    switchedAt: new Date().toISOString(),
    ...payload,
  };

  return {
    ...state,
    switchLogs: [log, ...state.switchLogs].slice(0, MAX_SWITCH_LOGS),
  };
}

export function resolveModuleRoutingTarget(
  state: AiFeatureRoutingState,
  moduleId: string
): AiResolvedModuleTarget | null {
  const moduleRoute = state.modules.find((item) => item.moduleId === moduleId);
  if (!moduleRoute) {
    return null;
  }

  if (moduleRoute.currentMode === "backup" && moduleRoute.backupTarget) {
    return {
      moduleRoute,
      target: moduleRoute.backupTarget,
      targetMode: "backup",
    };
  }

  if (moduleRoute.primaryTarget) {
    return {
      moduleRoute,
      target: moduleRoute.primaryTarget,
      targetMode: "primary",
    };
  }

  return {
    moduleRoute,
    target: moduleRoute.defaultTarget,
    targetMode: "default",
  };
}

export function switchModuleToBackupWithLog(
  state: AiFeatureRoutingState,
  moduleId: string,
  reason: string,
  automatic = true
): AiFeatureRoutingState {
  const current = state.modules.find((moduleRoute) => moduleRoute.moduleId === moduleId);
  if (!current?.backupTarget || current.currentMode === "backup") {
    return state;
  }

  const nextModules = state.modules.map((moduleRoute) =>
    moduleRoute.moduleId === moduleId
      ? {
          ...moduleRoute,
          currentMode: "backup" as const,
        }
      : moduleRoute
  );

  return appendSwitchLog(
    {
      ...state,
      modules: nextModules,
    },
    {
      moduleId,
      moduleLabel: current.moduleLabel,
      fromMode: current.currentMode,
      toMode: "backup",
      reason,
      automatic,
    }
  );
}

export function getProviderDisplayName(
  providers: AiProviderConfig[],
  providerId: string
): string {
  const provider = providers.find((item) => item.id === providerId);
  return firstNonEmptyString(provider?.name, providerId) ?? providerId;
}
