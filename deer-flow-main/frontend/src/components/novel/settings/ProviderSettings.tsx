'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore, type LlmProviderConfig } from '@/core/novel/useSettingsStore';
import { Plus, Trash2, Save } from 'lucide-react';

export const ProviderSettings: React.FC = () => {
  const { llmProviders, setLlmProviders, addLlmProvider, updateLlmProvider, deleteLlmProvider } = useSettingsStore();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<Partial<LlmProviderConfig>>({});

  const handleAdd = () => {
    const id = crypto.randomUUID();
    const newProvider: LlmProviderConfig = {
      id,
      name: 'New Provider',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      models: [],
    };
    addLlmProvider(newProvider);
    setEditingId(id);
    setFormData(newProvider);
  };

  const handleSave = () => {
    if (editingId) {
      updateLlmProvider(editingId, formData);
      setEditingId(null);
    }
  };

  const handleDelete = (id: string) => {
    deleteLlmProvider(id);
    if (editingId === id) setEditingId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM 提供商设置</CardTitle>
        <CardDescription>配置和管理 AI 模型的提供商信息</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {llmProviders.map((provider) => (
            <div key={provider.id} className="p-3 rounded-lg border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{provider.name}</p>
                  <p className="text-xs text-muted-foreground">{provider.provider}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingId(provider.id); setFormData(provider); }}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(provider.id)}>
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
                    <Select value={formData.provider} onValueChange={(v) => setFormData({ ...formData, provider: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <Input
                      type="password"
                      value={formData.apiKey || ''}
                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Base URL</Label>
                    <Input
                      value={formData.baseUrl || ''}
                      onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <Button onClick={handleSave} className="w-full">保存</Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={handleAdd} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          添加提供商
        </Button>
      </CardContent>
    </Card>
  );
};
