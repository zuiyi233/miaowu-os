'use client';

import { AlertTriangle, Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActionProtocol, ExecutionGate } from '@/core/ai/global-ai-service';

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_novel: '创建小说项目',
  build_world: '构建世界观',
  finalize_project: '定稿项目',
  import_book: '导入书籍',
  manage_foreshadow: '管理伏笔',
  manage_chapter: '管理章节',
  manage_outline: '管理大纲',
  manage_character: '管理角色',
  manage_relationship: '管理关系',
  manage_organization: '管理组织',
  manage_item: '管理物品',
  manage_project: '管理项目',
};

const SLOT_LABELS: Record<string, string> = {
  title: '书名',
  genre: '类型',
  theme: '题材/主题',
  audience: '目标受众',
  target_words: '目标字数',
  project_id: '项目',
  chapter_selector: '章节',
  character_selector: '角色',
  action: '操作',
};

function getActionLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] || actionType;
}

function getSlotLabel(key: string): string {
  return SLOT_LABELS[key] || key;
}

function formatSlotValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number') return value > 0 ? String(value) : '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '—';
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value === 'string' ? value : '—';
}

interface ConfirmationCardProps {
  actionProtocol: ActionProtocol;
  executionGate?: ExecutionGate;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onEnterExecutionMode?: () => void;
}

export function ConfirmationCard({
  actionProtocol,
  executionGate,
  disabled = false,
  onConfirm,
  onCancel,
  onEnterExecutionMode,
}: ConfirmationCardProps) {
  const { action_type, pending_action, slot_schema } = actionProtocol;
  const actionLabel = getActionLabel(action_type);

  const argsSummary = (pending_action?.args_summary ?? pending_action?.args ?? {}) as Record<string, unknown>;
  const schemaEntries = Object.entries(slot_schema || {});
  const hasSchemaEntries = schemaEntries.length > 0;
  const hasArgsSummary = Object.keys(argsSummary).length > 0;

  const displayEntries = hasSchemaEntries
    ? schemaEntries.map(([key, _schemaVal]) => {
        const rawValue = argsSummary[key];
        const displayValue = rawValue !== undefined ? formatSlotValue(rawValue) : '—';
        return { key, label: getSlotLabel(key), value: displayValue };
      })
    : Object.entries(argsSummary).map(([key, val]) => ({
        key,
        label: getSlotLabel(key),
        value: formatSlotValue(val),
      }));

  const isExecutionModeActive = executionGate?.execution_mode === true;

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="font-semibold text-amber-800 dark:text-amber-300">
          操作确认
        </span>
        <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400">
          {actionLabel}
        </Badge>
      </div>

      <p className="text-amber-700 dark:text-amber-300 mb-2">
        即将执行：<strong>{actionLabel}</strong>
      </p>

      {displayEntries.length > 0 && (
        <div className="rounded bg-white dark:bg-background/80 p-2 mb-3 text-xs space-y-1">
          {displayEntries.map(({ key, label, value }) => (
            <div key={key} className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">{label}</span>
              <span className="text-foreground break-all">{value}</span>
            </div>
          ))}
        </div>
      )}

      {!hasSchemaEntries && !hasArgsSummary && (
        <p className="text-amber-600 dark:text-amber-400 text-xs mb-3">
          请确认是否执行此操作。
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {!isExecutionModeActive && onEnterExecutionMode ? (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={disabled}
            onClick={onEnterExecutionMode}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            开启执行模式并执行
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={disabled}
            onClick={onConfirm}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            确认执行
          </Button>
        )}
        {!isExecutionModeActive && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onConfirm}
          >
            仅执行本次
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          disabled={disabled}
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          取消
        </Button>
        {isExecutionModeActive && (
          <Badge variant="secondary" className="text-xs">
            执行模式已开启
          </Badge>
        )}
      </div>
    </div>
  );
}
