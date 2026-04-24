'use client';

import { Plus, Trash2, Save, RefreshCw, CheckCircle2 } from 'lucide-react';
import React, { useCallback, useEffect } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAiProviderStore,
  type AiProviderConfig,
  type AiProviderType,
} from '@/core/ai/ai-provider-store';

export const createDefaultProvider = (id: string): AiProviderConfig => ({
  id,
  name: 'New Provider',
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  models: [],
  isActive: false,
  hasApiKey: false,
  clearApiKey: false,
});

export const parseModelsInput = (value: string): string[] =>
  value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

type ProviderSettingsActions = Pick<
  ReturnType<typeof useAiProviderStore>,
  'addProvider' | 'updateProvider' | 'deleteProvider' | 'setActiveProvider' | 'saveDraftToServer'
>;

const useProviderEditor = ({ addProvider, updateProvider, deleteProvider, setActiveProvider, saveDraftToServer }: ProviderSettingsActions) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<Partial<AiProviderConfig>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!editingId) return;
    updateProvider(editingId, formData);

    setSaving(true);
    setSaveError(null);
    try {
      await saveDraftToServer();
      setEditingId(null);
      setFormData({});
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [editingId, formData, saveDraftToServer, updateProvider]);

  const handleAdd = useCallback(() => {
    const id = crypto.randomUUID();
    const newProvider = createDefaultProvider(id);
    addProvider(newProvider);
    setEditingId(id);
    setFormData(newProvider);
  }, [addProvider]);

  const handleDelete = useCallback(
    async (id: string) => {
      deleteProvider(id);
      if (editingId === id) {
        setEditingId(null);
        setFormData({});
      }

      setSaving(true);
      setSaveError(null);
      try {
        await saveDraftToServer();
      } catch (err) {
        const message = err instanceof Error ? err.message : '删除后保存失败';
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    },
    [deleteProvider, editingId, saveDraftToServer],
  );

  const handleSetActive = useCallback(
    async (id: string) => {
      setActiveProvider(id);
      setSaving(true);
      setSaveError(null);
      try {
        await saveDraftToServer();
      } catch (err) {
        const message = err instanceof Error ? err.message : '切换后保存失败';
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    },
    [saveDraftToServer, setActiveProvider],
  );

  return {
    editingId,
    setEditingId,
    formData,
    setFormData,
    saving,
    setSaving,
    saveError,
    setSaveError,
    handleSave,
    handleAdd,
    handleDelete,
    handleSetActive,
  };
};

export const ProviderSettings: React.FC = () => {
  const {
    hydrated,
    hydrating,
    hydrationError,
    draft,
    isDirty,
    ensureHydrated,
    refreshFromServer,
    resetDraftToEffective,
    saveDraftToServer,
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
  } = useAiProviderStore();

  const {
    editingId,
    setEditingId,
    formData,
    setFormData,
    saving,
    setSaving,
    saveError,
    setSaveError,
    handleSave,
    handleAdd,
    handleDelete,
    handleSetActive,
  } = useProviderEditor({
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
    saveDraftToServer,
  });

  useEffect(() => {
    ensureHydrated().catch(() => undefined);
  }, [ensureHydrated]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>LLM 提供商设置</CardTitle>
            <CardDescription>
              统一由后端 /api/user/ai-settings 作为单一真源（两处入口共享）
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveError(null);
                refreshFromServer().catch((err) => {
                  const message = err instanceof Error ? err.message : '刷新失败';
                  setSaveError(message);
                });
              }}
              disabled={hydrating || saving}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${hydrating ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={resetDraftToEffective}
              disabled={saving || !hydrated}
            >
              撤销未保存
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                setSaving(true);
                setSaveError(null);
                try {
                  await saveDraftToServer();
                } catch (err) {
                  const message = err instanceof Error ? err.message : '保存失败';
                  setSaveError(message);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={Boolean(hydrationError) || saving || !isDirty}
            >
              <Save className="h-4 w-4 mr-1" />
              保存更改
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {hydrationError && (
          <Alert variant="destructive">
            <AlertTitle>AI 设置加载失败</AlertTitle>
            <AlertDescription>
              {hydrationError}（严格以后端为准，已禁用本地回退编辑）
            </AlertDescription>
          </Alert>
        )}

        {saveError && (
          <Alert variant="destructive">
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {draft.providers.map((provider) => (
            <div key={provider.id} className="p-3 rounded-lg border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm flex items-center gap-2">
                    {provider.name}
                    {provider.isActive && (
                      <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded">
                        当前使用
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {provider.provider}
                    {provider.models?.[0] ? ` · ${provider.models[0]}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!provider.isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => void handleSetActive(provider.id)}
                      title="设为当前使用"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingId(provider.id);
                      setFormData({ ...provider, apiKey: '', clearApiKey: false });
                    }}
                    title="编辑"
                  >
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => void handleDelete(provider.id)}
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {editingId === provider.id && (
                <div className="space-y-3 mt-3">
                  <div>
                    <Label>名称</Label>
                    <Input
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>提供商</Label>
                    <Select
                      value={formData.provider ?? 'openai'}
                      onValueChange={(v) =>
                        setFormData({ ...formData, provider: v as AiProviderType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                        <SelectItem value="custom">自定义</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>API Key</Label>
                    {provider.hasApiKey ? (
                      <p className="text-xs text-muted-foreground">
                        已保存 API Key（留空将保留；如需清空请点击“清空已保存”）
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        未检测到已保存 API Key（可留空以使用后端环境变量/默认配置）
                      </p>
                    )}
                    <Input
                      type="password"
                      value={formData.apiKey || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, apiKey: e.target.value, clearApiKey: false })
                      }
                    />
                    {provider.hasApiKey && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFormData({ ...formData, apiKey: '', clearApiKey: true })}
                      >
                        清空已保存
                      </Button>
                    )}
                  </div>
                  <div>
                    <Label>Base URL</Label>
                    <Input
                      value={formData.baseUrl || ''}
                      onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div>
                    <Label>模型列表（逗号分隔）</Label>
                    <Input
                      value={formData.models?.join(', ') ?? ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          models: parseModelsInput(e.target.value),
                        })
                      }
                      placeholder="gpt-4o, gpt-4o-mini"
                    />
                  </div>
                  <Button onClick={handleSave} className="w-full" disabled={saving}>
                    {saving ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        保存中...
                      </>
                    ) : (
                      '保存'
                    )}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          onClick={handleAdd}
          className="w-full"
          disabled={Boolean(hydrationError) || saving}
        >
          <Plus className="h-4 w-4 mr-2" />
          添加提供商
        </Button>
      </CardContent>
    </Card>
  );
};
