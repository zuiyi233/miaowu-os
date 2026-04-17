'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Sparkles, Heart, Download, Eye, RefreshCw, Trash2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { getBackendBaseURL } from '@/core/config';

interface PromptTemplate {
  id: string; template_name: string; template_content: string;
  description: string; category: string; parameters?: string;
  is_active: boolean; is_system_default: boolean;
}

interface PromptWorkshopProps {
  projectId?: string;
}

export function PromptWorkshop({ projectId }: PromptWorkshopProps) {
  const backendBase = getBackendBaseURL();
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [myItems, setMyItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'community' | 'mine'>('community');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ template_name: '', template_content: '', description: '', category: 'general', parameters: '' });
  const [previewId, setPreviewId] = useState<string | null>(null);

  const loadCommunity = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchTerm) params.set('q', searchTerm);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      const res = await fetch(`${backendBase}/api/prompts/community?${params}`, { credentials: 'include' });
      if (res.ok) setItems(((await res.json()).items || []).map(normalize));
    } catch {} finally { setLoading(false); }
  }, [backendBase, searchTerm, categoryFilter]);

  const loadMyPrompts = useCallback(async () => {
    try {
      const res = await fetch(`${backendBase}/api/prompts/mine?project_id=${projectId || ''}`, { credentials: 'include' });
      if (res.ok) setMyItems(((await res.json()).items || []).map(normalize));
    } catch {}
  }, [backendBase, projectId]);

  useEffect(() => { if (tab === 'community') loadCommunity(); else loadMyPrompts(); }, [tab, loadCommunity, loadMyPrompts]);

  const normalize = (t: Record<string, unknown>): PromptTemplate => ({
    id: String(t.id), template_name: String(t.template_name || t.name || ''),
    template_content: String(t.template_content || t.content || ''),
    description: String(t.description || ''), category: String(t.category || 'general'),
    parameters: t.parameters ? String(t.parameters) : undefined,
    is_active: Boolean(t.is_active ?? true), is_system_default: Boolean(t.is_system_default),
  });

  const handleCreate = async () => {
    try {
      const res = await fetch(`${backendBase}/api/prompts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...form, project_id: projectId }),
      });
      if (!res.ok) throw new Error('创建失败');
      toast.success('Prompt已创建'); setIsCreateOpen(false);
      setForm({ template_name: '', template_content: '', description: '', category: 'general', parameters: '' }); loadMyPrompts();
    } catch (err) { toast.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleToggleFavorite = async (id: string) => {
    try {
      await fetch(`${backendBase}/api/prompts/${id}/favorite`, { method: 'POST', credentials: 'include' });
      loadCommunity();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该模板吗？')) return;
    try {
      const res = await fetch(`${backendBase}/api/prompts/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('删除失败'); toast.success('已删除'); loadMyPrompts();
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
  };

  const currentList = tab === 'community' ? items : myItems;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5" /> AI提示词工坊</h2>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />自定义模板
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="community">社区推荐</TabsTrigger>
          <TabsTrigger value="mine">我的模板</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <div className="flex gap-2 mb-4">
            <Input placeholder="搜索提示词..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-[240px]" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                <SelectItem value="writing">写作</SelectItem>
                <SelectItem value="worldbuilding">世界观</SelectItem>
                <SelectItem value="character">角色</SelectItem>
                <SelectItem value="plot">情节</SelectItem>
                <SelectItem value="dialogue">对话</SelectItem>
              </SelectContent>
            </Select>
            {(tab === 'community') && <Button size="sm" variant="outline" onClick={loadCommunity}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8">加载中...</p>
          ) : currentList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentList.map((item) => (
                <Card key={item.id} className={cn(!item.is_active && "opacity-60")}>
                  <CardContent className="pt-4 space-y-2.5">
                    <div className="flex items-start justify-between">
                      <h3 className="font-medium text-sm line-clamp-1">{item.template_name}</h3>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{item.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description || '暂无描述'}</p>
                    <pre className="text-[11px] bg-muted/50 p-2 rounded font-mono max-h-[80px] overflow-hidden line-clamp-3 whitespace-pre-wrap break-all">
                      {item.template_content.slice(0, 150)}
                    </pre>
                    <div className="flex items-center gap-1 pt-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewId(item.id)}>
                        <Eye className="w-3 h-3 mr-1" />预览
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(item.template_content).then(() => toast('已复制'))}>
                        <Download className="w-3 h-3 mr-1" />复制
                      </Button>
                      {tab === 'community' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleToggleFavorite(item.id)}>
                          <Heart className="w-3 h-3 mr-1" />收藏
                        </Button>
                      )}
                      {tab === 'mine' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-3 h-3 mr-1" />删除
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">暂无{tab === 'community' ? '社区' : '我的'}提示词模板</p>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={!!previewId} onOpenChange={(v) => !v && setPreviewId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{currentList.find((i) => i.id === previewId)?.template_name}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[400px] pr-2 -mr-2">
            <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/30 p-4 rounded">{currentList.find((i) => i.id === previewId)?.template_content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>创建自定义Prompt模板</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>模板名称</Label><Input value={form.template_name} onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))} /></div>
            <div><Label>分类</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">通用</SelectItem><SelectItem value="writing">写作</SelectItem>
                  <SelectItem value="worldbuilding">世界观</SelectItem><SelectItem value="character">角色</SelectItem>
                  <SelectItem value="plot">情节</SelectItem><SelectItem value="dialogue">对话</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>描述</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Prompt内容</Label><Textarea rows={6} value={form.template_content} onChange={(e) => setForm((f) => ({ ...f, template_content: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
