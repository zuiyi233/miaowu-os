'use client';

import { Plus, Edit, Trash2, Star } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { fetch as authFetch } from '@/core/api/fetcher';
import { getBackendBaseURL } from '@/core/config';
import { useI18n } from '@/core/i18n/hooks';
import { cn } from '@/lib/utils';

interface WritingStyle {
  id: string; name: string; description: string; style_params: string;
  is_default: boolean; is_active: boolean;
}

interface WritingStylesProps {
  projectId: string;
}

export function WritingStyles({ projectId }: WritingStylesProps) {
  const backendBase = getBackendBaseURL();
  const { t } = useI18n();
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<WritingStyle | null>(null);
  const [form, setForm] = useState({ name: '', description: '', style_params: '{}' });

  const loadStyles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${backendBase}/api/writing-styles?project_id=${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      setStyles(Array.isArray(data) ? data : data.styles || []);
    } catch (error) {
      console.error('Failed to load styles:', error);
      toast.error(t.novel.loadFailed);
    } finally { setLoading(false); }
  }, [projectId, backendBase, t]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  const handleSave = async (isEdit: boolean) => {
    try {
      const url = isEdit ? `/api/writing-styles/${editing?.id}` : '/api/writing-styles';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await authFetch(`${backendBase}${url}`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, project_id: projectId }),
      });
      if (!res.ok) throw new Error(isEdit ? t.novel.updateFailed : t.novel.createFailed);
      toast(isEdit ? t.novel.styleUpdated : t.novel.styleCreated);
      setIsCreateOpen(false); setIsEditOpen(false); setEditing(null);
      setForm({ name: '', description: '', style_params: '{}' }); loadStyles();
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.operationFailed); }
  };

  const handleToggleActive = async (style: WritingStyle) => {
    try {
      const res = await authFetch(`${backendBase}/api/writing-styles/${style.id}/toggle`, { method: 'POST' });
      if (!res.ok) return;
      loadStyles();
    } catch (error) {
      console.error('Failed to toggle style:', error);
      toast.error(t.novel.operationFailed);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.novel.confirmDeleteStyle)) return;
    try {
      const res = await authFetch(`${backendBase}/api/writing-styles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t.novel.deleteFailed);
      toast.success(t.novel.deleted); loadStyles();
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.deleteFailed); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Star className="w-5 h-5" /> {t.novel.writingStyleConfig}</h2>
        <Button size="sm" onClick={() => { setForm({ name: '', description: '', style_params: '{}' }); setIsCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />{t.novel.newStyle}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8">{t.novel.loading}</p>
      ) : styles.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {styles.map((style) => (
            <Card key={style.id} className={cn(!style.is_active && "opacity-60")}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-sm">{style.name}</h3>
                  <div className="flex items-center gap-1.5">
                    {style.is_default && <Badge variant="default" className="text-[10px]">{t.novel.defaultStyle}</Badge>}
                    <Switch checked={style.is_active} onCheckedChange={() => handleToggleActive(style)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{style.description || t.novel.noDescription}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setEditing(style); setForm({ name: style.name, description: style.description || '', style_params: style.style_params || '{}' }); setIsEditOpen(true); }}>
                    <Edit className="w-3 h-3 mr-1" />{t.novel.edit}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(style.id)}>
                    <Trash2 className="w-3 h-3 mr-1" />{t.novel.confirmDelete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">{t.novel.noWritingStyles}</p>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(v) => { if (!v) { setIsCreateOpen(false); setIsEditOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? t.novel.editWritingStyle : t.novel.createWritingStyle}</DialogTitle>
            <DialogDescription>{t.novel.styleParams}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t.novel.styleName}</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t.novel.styleNamePlaceholder} /></div>
            <div><Label>{t.novel.styleDescription}</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t.novel.styleDescriptionPlaceholder} /></div>
            <div><Label>{t.novel.styleParams}</Label><Textarea rows={4} className="font-mono text-xs" value={form.style_params} onChange={(e) => setForm((f) => ({ ...f, style_params: e.target.value }))} placeholder='{"tone": "formal", "vocabulary": "classical"}' /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); setEditing(null); }}>{t.novel.cancel}</Button>
            <Button onClick={() => handleSave(!!isEditOpen)}>{isEditOpen ? t.novel.update : t.novel.create}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
