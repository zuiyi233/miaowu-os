'use client';

import { Globe, Edit3, RefreshCw, Eye, Save } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { getBackendBaseURL } from '@/core/config';
import { cn } from '@/lib/utils';

import { SSELoadingOverlay } from './SSELoadingOverlay';

interface WorldData {
  time_period?: string;
  location?: string;
  atmosphere?: string;
  rules?: string;
}

interface WorldSettingProps {
  projectId: string;
}

export function WorldSetting({ projectId }: WorldSettingProps) {
  const [worldData, setWorldData] = useState<WorldData>({});
  const [loading, setLoading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState(0);
  const [regenMessage, setRegenMessage] = useState('');
  const [previewData, setPreviewData] = useState<WorldData | null>(null);
  const [editForm, setEditForm] = useState<WorldData>({});
  const [saving, setSaving] = useState(false);

  const backendBase = getBackendBaseURL();

  const loadWorld = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${backendBase}/api/projects/${projectId}`, { credentials: 'include' });
      if (!res.ok) return;
      const project = await res.json();
      setWorldData({
        time_period: project.world_time_period || '',
        location: project.world_location || '',
        atmosphere: project.world_atmosphere || '',
        rules: project.world_rules || '',
      });
    } catch (err) { console.error('加载世界观失败:', err); }
    finally { setLoading(false); }
  }, [projectId, backendBase]);

  useEffect(() => { loadWorld(); }, [loadWorld]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch(`${backendBase}/api/projects/${projectId}/world-building`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('保存失败');
      toast.success('世界观已保存');
      setWorldData(editForm);
      setIsEditOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  };

  const handleRegenerate = async () => {
    if (!window.confirm('确定要使用AI重新生成世界观设定吗？这将替换当前的世界观内容。')) return;

    setIsRegenerating(true); setRegenProgress(0); setRegenMessage('准备重新生成世界观...');

    try {
      const res = await fetch(`${backendBase}/api/wizard/regenerate-world-building`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
        credentials: 'include',
      });

      if (!res.ok || !res.body) throw new Error('请求失败');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const data = JSON.parse(trimmed.slice(5).trim());
            if (data.type === 'progress') { setRegenProgress(data.progress || 0); setRegenProgress(data.message || ''); }
            else if (data.type === 'result') { setPreviewData(data.data || data); }
            else if (data.type === 'error') throw new Error(data.message || '生成失败');
          } catch {}
        }
      }

      toast.success('世界观重新生成完成！');
      setIsPreviewOpen(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : '重新生成失败'); }
    finally { setIsRegenerating(false); }
  };

  const handleApplyPreview = async () => {
    if (!previewData) return;
    try {
      setSaving(true);
      const res = await fetch(`${backendBase}/api/projects/${projectId}/world-building`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewData), credentials: 'include',
      });
      if (!res.ok) throw new Error('应用失败');
      setWorldData(previewData);
      setIsPreviewOpen(false); setPreviewData(null);
      toast.success('新世界观已应用');
    } catch (err) { toast.error(err instanceof Error ? err.message : '应用失败'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">加载中...</div>;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="w-5 h-5" /> 世界观设定
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditForm(worldData); setIsEditOpen(true); }}>
              <Edit3 className="w-3.5 h-3.5 mr-1" />编辑
            </Button>
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isRegenerating && "animate-spin")} />AI重新生成
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-4">
            <InfoRow label="时代背景" value={worldData.time_period} />
            <Separator />
            <InfoRow label="地理环境" value={worldData.location} />
            <Separator />
            <InfoRow label="氛围基调" value={worldData.atmosphere} />
            <Separator />
            <InfoRow label="世界规则" value={worldData.rules} multiline />
          </CardContent>
        </Card>

        {!worldData.time_period && !worldData.location && (
          <p className="text-sm text-muted-foreground text-center py-8">暂无世界观数据，点击"编辑"或"AI重新生成"来创建</p>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>编辑世界观</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>时代背景</Label><Input value={editForm.time_period || ''} onChange={(e) => setEditForm((p) => ({ ...p, time_period: e.target.value }))} /></div>
            <div><Label>地理环境</Label><Input value={editForm.location || ''} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))} /></div>
            <div><Label>氛围基调</Label><Input value={editForm.atmosphere || ''} onChange={(e) => setEditForm((p) => ({ ...p, atmosphere: e.target.value }))} /></div>
            <div><Label>世界规则</Label><Textarea rows={4} value={editForm.rules || ''} onChange={(e) => setEditForm((p) => ({ ...p, rules: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}><Save className="w-4 h-4 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={(v) => !v && setPreviewData(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>预览新生成的世界观</DialogTitle><DialogDescription>确认后将替换当前世界观设定</DialogDescription></DialogHeader>
          {previewData && (
            <ScrollArea className="max-h-[400px] pr-2 -mr-2">
              <div className="space-y-3">
                <InfoRow label="时代背景" value={previewData.time_period} />
                <Separator /><InfoRow label="地理环境" value={previewData.location} />
                <Separator /><InfoRow label="氛围基调" value={previewData.atmosphere} />
                <Separator /><InfoRow label="世界规则" value={previewData.rules} multiline />
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewData(null); setIsPreviewOpen(false); }}>放弃</Button>
            <Button onClick={handleApplyPreview} disabled={saving}><Eye className="w-4 h-4 mr-1" />应用此版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loading Overlay */}
      <SSELoadingOverlay loading={isRegenerating} progress={regenProgress} message={regenMessage} />
    </>
  );
}

function InfoRow({ label, value, multiline }: { label: string; value?: string | null; multiline?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-20 text-sm font-medium text-muted-foreground pt-0.5">{label}</span>
      {multiline ? (
        <pre className="flex-1 text-sm whitespace-pre-wrap font-sans">{value}</pre>
      ) : (
        <span className="flex-1 text-sm">{value}</span>
      )}
    </div>
  );
}
