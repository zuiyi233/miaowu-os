'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getBackendBaseURL } from '@/core/config';

interface WritingStyle {
  id: string; name: string; description: string; style_params: string;
  is_default: boolean; is_active: boolean;
}

interface WritingStylesProps {
  projectId: string;
}

export function WritingStyles({ projectId }: WritingStylesProps) {
  const backendBase = getBackendBaseURL();
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<WritingStyle | null>(null);
  const [form, setForm] = useState({ name: '', description: '', style_params: '{}' });

  const loadStyles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${backendBase}/api/writing-styles?project_id=${projectId}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setStyles(Array.isArray(data) ? data : data.styles || []);
    } catch {} finally { setLoading(false); }
  }, [projectId, backendBase]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  const handleSave = async (isEdit: boolean) => {
    try {
      const url = isEdit ? `/api/writing-styles/${editing?.id}` : '/api/writing-styles';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(`${backendBase}${url}`, {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...form, project_id: projectId }),
      });
      if (!res.ok) throw new Error(isEdit ? '更新失败' : '创建失败');
      toast(isEdit ? '风格已更新' : '风格已创建');
      setIsCreateOpen(false); setIsEditOpen(false); setEditing(null);
      setForm({ name: '', description: '', style_params: '{}' }); loadStyles();
    } catch (err) { toast.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleToggleActive = async (style: WritingStyle) => {
    try {
      const res = await fetch(`${backendBase}/api/writing-styles/${style.id}/toggle`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return;
      loadStyles();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该写作风格吗？')) return;
    try {
      const res = await fetch(`${backendBase}/api/writing-styles/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('删除失败');
      toast.success('已删除'); loadStyles();
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Star className="w-5 h-5" /> 写作风格配置</h2>
        <Button size="sm" onClick={() => { setForm({ name: '', description: '', style_params: '{}' }); setIsCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />新建风格
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8">加载中...</p>
      ) : styles.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {styles.map((style) => (
            <Card key={style.id} className={cn(!style.is_active && "opacity-60")}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-sm">{style.name}</h3>
                  <div className="flex items-center gap-1.5">
                    {style.is_default && <Badge variant="default" className="text-[10px]">默认</Badge>}
                    <Switch checked={style.is_active} onCheckedChange={() => handleToggleActive(style)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{style.description || '暂无描述'}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setEditing(style); setForm({ name: style.name, description: style.description || '', style_params: style.style_params || '{}' }); setIsEditOpen(true); }}>
                    <Edit className="w-3 h-3 mr-1" />编辑
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(style.id)}>
                    <Trash2 className="w-3 h-3 mr-1" />删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">暂无写作风格配置</p>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(v) => { if (!v) { setIsCreateOpen(false); setIsEditOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? '编辑' : '新建'}写作风格</DialogTitle>
            <DialogDescription>配置AI生成文本时的写作风格参数</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>风格名称</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="如：古风典雅、现代都市、热血玄幻..." /></div>
            <div><Label>描述</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="简要描述该风格的特点..." /></div>
            <div><Label>风格参数（JSON）</Label><Textarea rows={4} className="font-mono text-xs" value={form.style_params} onChange={(e) => setForm((f) => ({ ...f, style_params: e.target.value }))} placeholder='{"tone": "formal", "vocabulary": "classical"}' /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); setEditing(null); }}>取消</Button>
            <Button onClick={() => handleSave(!!isEditOpen)}>{isEditOpen ? '更新' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
