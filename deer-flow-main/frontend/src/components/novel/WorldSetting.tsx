'use client';

import { Globe, Edit3, RefreshCw, Eye, Save } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { fetch as authFetch } from '@/core/api/fetcher';
import { getBackendBaseURL } from '@/core/config';
import { useI18n } from '@/core/i18n/hooks';
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
  const { t } = useI18n();
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
      const res = await authFetch(`${backendBase}/api/projects/${projectId}`);
      if (!res.ok) return;
      const project = await res.json();
      setWorldData({
        time_period: project.world_time_period || '',
        location: project.world_location || '',
        atmosphere: project.world_atmosphere || '',
        rules: project.world_rules || '',
      });
    } catch (err) { console.error(t.novel.loadGraphFailed, err); }
    finally { setLoading(false); }
  }, [projectId, backendBase, t]);

  useEffect(() => { loadWorld(); }, [loadWorld]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await authFetch(`${backendBase}/api/projects/${projectId}/world-building`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error(t.novel.saveFailed);
      toast.success(t.novel.worldviewSaved);
      setWorldData(editForm);
      setIsEditOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.saveFailed); }
    finally { setSaving(false); }
  };

  const handleRegenerate = async () => {
    if (!window.confirm(t.novel.confirmRegenerateWorldview)) return;

    setIsRegenerating(true); setRegenProgress(0); setRegenMessage(t.novel.preparingRegenerate);

    try {
      const res = await authFetch(`${backendBase}/api/wizard/regenerate-world-building`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });

      if (!res.ok || !res.body) throw new Error(t.novel.requestFailed);
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
            if (data.type === 'progress') {
              setRegenProgress(data.progress || 0);
              setRegenMessage(data.message || '');
            }
            else if (data.type === 'result') { setPreviewData(data.data || data); }
            else if (data.type === 'error') throw new Error(data.message || t.novel.regenerateFailed);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== t.novel.regenerateFailed) {
              console.warn('SSE parse skip:', parseErr);
            } else throw parseErr;
          }
        }
      }

      toast.success(t.novel.regenerateComplete);
      setIsPreviewOpen(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.regenerateFailed); }
    finally { setIsRegenerating(false); }
  };

  const handleApplyPreview = async () => {
    if (!previewData) return;
    try {
      setSaving(true);
      const res = await authFetch(`${backendBase}/api/projects/${projectId}/world-building`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewData),
      });
      if (!res.ok) throw new Error(t.novel.applyFailed);
      setWorldData(previewData);
      setIsPreviewOpen(false); setPreviewData(null);
      toast.success(t.novel.newWorldviewApplied);
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.applyFailed); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">{t.novel.loading}</div>;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="w-5 h-5" /> {t.novel.worldSetting}
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditForm(worldData); setIsEditOpen(true); }}>
              <Edit3 className="w-3.5 h-3.5 mr-1" />{t.novel.edit}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isRegenerating && "animate-spin")} />{t.novel.aiRegenerate}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-4">
            <InfoRow label={t.novel.timePeriod} value={worldData.time_period} />
            <Separator />
            <InfoRow label={t.novel.location} value={worldData.location} />
            <Separator />
            <InfoRow label={t.novel.fieldAtmosphere} value={worldData.atmosphere} />
            <Separator />
            <InfoRow label={t.novel.worldRules} value={worldData.rules} multiline />
          </CardContent>
        </Card>

        {!worldData.time_period && !worldData.location && (
          <p className="text-sm text-muted-foreground text-center py-8">{t.novel.noWorldData}</p>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.novel.editWorldSetting}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t.novel.timePeriod}</Label><Input value={editForm.time_period || ''} onChange={(e) => setEditForm((p) => ({ ...p, time_period: e.target.value }))} /></div>
            <div><Label>{t.novel.location}</Label><Input value={editForm.location || ''} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))} /></div>
            <div><Label>{t.novel.fieldAtmosphere}</Label><Input value={editForm.atmosphere || ''} onChange={(e) => setEditForm((p) => ({ ...p, atmosphere: e.target.value }))} /></div>
            <div><Label>{t.novel.worldRules}</Label><Textarea rows={4} value={editForm.rules || ''} onChange={(e) => setEditForm((p) => ({ ...p, rules: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>{t.novel.cancel}</Button>
            <Button onClick={handleSave} disabled={saving}><Save className="w-4 h-4 mr-1" />{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={(v) => !v && setPreviewData(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.novel.previewNewWorldview}</DialogTitle><DialogDescription>{t.novel.confirmReplaceWorldview}</DialogDescription></DialogHeader>
          {previewData && (
            <ScrollArea className="max-h-[400px] pr-2 -mr-2">
              <div className="space-y-3">
                <InfoRow label={t.novel.timePeriod} value={previewData.time_period} />
                <Separator /><InfoRow label={t.novel.location} value={previewData.location} />
                <Separator /><InfoRow label={t.novel.fieldAtmosphere} value={previewData.atmosphere} />
                <Separator /><InfoRow label={t.novel.worldRules} value={previewData.rules} multiline />
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewData(null); setIsPreviewOpen(false); }}>{t.novel.discard}</Button>
            <Button onClick={handleApplyPreview} disabled={saving}><Eye className="w-4 h-4 mr-1" />{t.novel.applyThisVersion}</Button>
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
