'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Eye, Pencil, Trash2, CheckCircle, XCircle,
  AlertTriangle, Flag, Plus, RefreshCw, MoreHorizontal,
  Search, Filter, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import {
  useForeshadowsQuery,
  useForeshadowStatsQuery,
  useCreateForeshadowMutation,
  useUpdateForeshadowMutation,
  useDeleteForeshadowMutation,
  usePlantForeshadowMutation,
  useResolveForeshadowMutation,
  useAbandonForeshadowMutation,
  useSyncForeshadowsMutation,
} from '@/core/novel/queries';
import type { Foreshadow, ForeshadowStats, ForeshadowStatus } from '@/core/novel/schemas';

const STATUS_CONFIG: Record<ForeshadowStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; colorClass: string }> = {
  pending: { label: '待埋入', variant: 'secondary', colorClass: 'text-gray-600 bg-gray-100' },
  planted: { label: '已埋入', variant: 'default', colorClass: 'text-green-700 bg-green-50 border-green-200' },
  resolved: { label: '已回收', variant: 'default', colorClass: 'text-blue-700 bg-blue-50 border-blue-200' },
  partially_resolved: { label: '部分回收', variant: 'outline', colorClass: 'text-orange-700 bg-orange-50 border-orange-200' },
  abandoned: { label: '已废弃', variant: 'secondary', colorClass: 'text-gray-500 bg-gray-50' },
};

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  identity: { label: '身世', color: 'bg-purple-100 text-purple-700 border-purple-300' },
  mystery: { label: '悬念', color: 'bg-pink-100 text-pink-700 border-pink-300' },
  item: { label: '物品', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  relationship: { label: '关系', color: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
  event: { label: '事件', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  ability: { label: '能力', color: 'bg-green-100 text-green-700 border-green-300' },
  prophecy: { label: '预言', color: 'bg-orange-100 text-orange-700 border-orange-300' },
};

const statusOrder: Record<ForeshadowStatus, number> = {
  planted: 1, pending: 2, partially_resolved: 3, resolved: 4, abandoned: 5,
};

interface ForeshadowsViewProps {
  novelId: string;
}

export function ForeshadowsView({ novelId }: ForeshadowsViewProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Dialog states
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [plantOpen, setPlantOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  const [currentF, setCurrentF] = useState<Foreshadow | null>(null);

  // Form state
  const [fTitle, setFTitle] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fContent, setFContent] = useState('');
  const [fPlantChapter, setFPlantChapter] = useState('');
  const [fTargetChapter, setFTargetChapter] = useState('');
  const [fImportance, setFImportance] = useState(0.5);
  const [fIsLongTerm, setIsLongTerm] = useState(false);
  const [fHintText, setFHintText] = useState('');
  const [fResolutionText, setFResolutionText] = useState('');
  const [fIsPartial, setIsPartial] = useState(false);

  const { data: foreshadowsData, refetch: refetchForeshadows } = useForeshadowsQuery(novelId, {
    status: statusFilter !== 'all' ? statusFilter : undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    source_type: sourceFilter !== 'all' ? sourceFilter : undefined,
    page: currentPage,
    limit: pageSize,
  });

  const { data: stats } = useForeshadowStatsQuery(novelId);

  const createMutation = useCreateForeshadowMutation();
  const updateMutation = useUpdateForeshadowMutation();
  const deleteMutation = useDeleteForeshadowMutation();
  const plantMutation = usePlantForeshadowMutation();
  const resolveMutation = useResolveForeshadowMutation();
  const abandonMutation = useAbandonForeshadowMutation();
  const syncMutation = useSyncForeshadowsMutation();

  const items = foreshadowsData?.items ?? [];
  const total = foreshadowsData?.total ?? 0;

  const resetForm = () => {
    setFTitle(''); setFCategory(''); setFContent(''); setFPlantChapter('');
    setFTargetChapter(''); setFImportance(0.5); setIsLongTerm(false);
    setFHintText(''); setFResolutionText(''); setIsPartial(false);
    setCurrentF(null);
  };

  const openEditDialog = (f?: Foreshadow) => {
    if (f) {
      setCurrentF(f); setFTitle(f.title); setFCategory(f.category ?? '');
      setFContent(f.description); setFImportance(f.importance / 10);
      setIsLongTerm(f.isLongTerm);
      setFPlantChapter(String(f.sourceChapter ?? ''));
      setFTargetChapter(String(f.targetChapter ?? ''));
    } else {
      resetForm();
    }
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!fTitle.trim() || !fContent.trim()) { toast.error('请填写标题和内容'); return; }
    try {
      const payload = {
        project_id: novelId,
        title: fTitle,
        description: fContent,
        category: fCategory || undefined,
        source_chapter: fPlantChapter ? parseInt(fPlantChapter) : undefined,
        target_chapter: fTargetChapter ? parseInt(fTargetChapter) : undefined,
        is_long_term: fIsLongTerm,
        importance: Math.round(fImportance * 10),
        status: currentF?.status || ('pending' as ForeshadowStatus),
        source_type: (currentF?.sourceType as string) || 'manual',
      };
      if (currentF) await updateMutation.mutateAsync({ foreshadowId: currentF.id, data: payload });
      else await createMutation.mutateAsync(payload);
      toast.success(currentF ? '伏笔更新成功' : '伏笔创建成功');
      setEditOpen(false); resetForm();
    } catch { toast.error('操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteMutation.mutateAsync(id); toast.success('删除成功'); }
    catch { toast.error('删除失败'); }
  };

  const handlePlant = async () => {
    if (!currentF || !fPlantChapter) return;
    try {
      await plantMutation.mutateAsync({
        foreshadowId: currentF.id,
        data: { planted_chapter: parseInt(fPlantChapter), planted_context: fHintText || undefined },
      });
      toast.success('已标记为埋入'); setPlantOpen(false); resetForm();
    } catch { toast.error('标记埋入失败'); }
  };

  const handleResolve = async () => {
    if (!currentF || !fPlantChapter) return;
    try {
      await resolveMutation.mutateAsync({
        foreshadowId: currentF.id,
        data: {
          resolved_chapter: parseInt(fPlantChapter),
          resolution_text: fResolutionText || undefined,
          resolution_type: fIsPartial ? 'partial' : 'full',
        },
      });
      toast.success('已标记为回收'); setResolveOpen(false); resetForm();
    } catch { toast.error('标记回收失败'); }
  };

  const handleAbandon = async (id: string) => {
    try { await abandonMutation.mutateAsync({ foreshadowId: id }); toast.success('已废弃'); }
    catch { toast.error('操作失败'); }
  };

  const handleSync = async () => {
    try {
      await syncMutation.mutateAsync({ projectId: novelId, autoSetPlanted: true });
      toast.success('同步完成');
      setSyncOpen(false);
    } catch { toast.error('同步失败'); }
  };

  const openDetail = (f: Foreshadow) => { setCurrentF(f); setDetailOpen(true); };
  const openPlant = (f: Foreshadow) => { setCurrentF(f); setFPlantChapter(''); setFHintText(''); setPlantOpen(true); };
  const openResolve = (f: Foreshadow) => { setCurrentF(f); setFPlantChapter(''); setFResolutionText(''); setIsPartial(false); setResolveOpen(true); };

  const totalPages = Math.ceil(total / pageSize);

  const renderStars = (val: number) => {
    const stars = Math.round(val * 5);
    return <span className="text-yellow-500">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Stats */}
      {stats && (
        <div className="flex-shrink-0 grid grid-cols-3 md:grid-cols-6 gap-3 px-4 pt-3">
          {[
            { label: '总计', value: stats.total, className: '' },
            { label: '待埋入', value: stats.pending, className: '' },
            { label: '已埋入', value: stats.planted, className: 'text-green-600' },
            { label: '已回收', value: stats.resolved, className: 'text-blue-600' },
            { label: '长线伏笔', value: stats.longTermCount, className: 'text-purple-600' },
            { label: '超期未回收', value: stats.overdueCount, className: stats.overdueCount > 0 ? 'text-red-600 font-semibold' : '' },
          ].map((s) => (
            <Card key={s.label} className="p-3"><div className="text-xs text-muted-foreground">{s.label}</div><div className={cn("text-xl font-bold", s.className)}>{s.value}</div></Card>
          ))}
        </div>
      )}
      {stats && stats.overdueCount > 0 && (
        <Alert className="mx-4 mt-2" variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>有 {stats.overdueCount} 个伏笔已超期未回收，请尽快处理</AlertDescription>
        </Alert>
      )}

      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="状态筛选" /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(STATUS_CONFIG).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue placeholder="分类筛选" /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部分类</SelectItem>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="来源" /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部</SelectItem><SelectItem value="analysis">分析</SelectItem><SelectItem value="manual">手动</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetchForeshadows()}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}><RefreshCw className="h-3 w-3 mr-1" />同步</Button>
          <Button size="sm" onClick={() => openEditDialog()}><Plus className="h-4 w-4 mr-1" />添加伏笔</Button>
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 p-4">
        <Card>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-[90px]">状态</TableHead>
              <TableHead>标题</TableHead>
              <TableHead className="w-[80px]">分类</TableHead>
              <TableHead className="w-[90px]">埋入章节</TableHead>
              <TableHead className="w-[90px]">计划回收</TableHead>
              <TableHead className="w-[80px]">重要性</TableHead>
              <TableHead className="w-[70px]">来源</TableHead>
              <TableHead className="w-[180px] text-right">操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">暂无伏笔数据，点击右上角添加</TableCell></TableRow>
              ) : items.map((f) => {
                const sc = STATUS_CONFIG[f.status];
                const cc = CATEGORY_CONFIG[f.category || ''] || { label: f.category || '-', color: '' };
                return (
                  <TableRow key={f.id}>
                    <TableCell><Badge variant={sc.variant as any} className={cn(sc.colorClass, "text-xs")}>{sc.label}</Badge></TableCell>
                    <TableCell>
                      <button className="text-left hover:text-primary hover:underline font-medium" onClick={() => openDetail(f)}>{f.title}</button>
                      {f.isLongTerm && <Badge variant="outline" className="ml-1 text-[10px]">长线</Badge>}
                    </TableCell>
                    <TableCell>{cc.label && <Badge variant="outline" className={cn("text-xs", cc.color)}>{cc.label}</Badge>}</TableCell>
                    <TableCell className="text-sm">{f.plantedChapter ? `第${f.plantedChapter}章` : '-'}</TableCell>
                    <TableCell className="text-sm">{f.targetChapter ? `第${f.targetChapter}章` : '-'}</TableCell>
                    <TableCell>{renderStars(f.importance)}</TableCell>
                    <TableCell><Badge variant={f.sourceType === 'analysis' ? 'default' : 'secondary'} className="text-xs">{f.sourceType === 'analysis' ? '分析' : '手动'}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(f)} title="详情"><Eye className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(f)} title="编辑"><Pencil className="h-3.5 w-3.5" /></Button>
                        {f.status === 'pending' && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPlant(f)} title="标记埋入"><Flag className="h-3.5 w-3.5" /></Button>}
                        {f.status === 'planted' && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openResolve(f)} title="标记回收"><CheckCircle className="h-3.5 w-3.5" /></Button>}
                        {f.status !== 'abandoned' && f.status !== 'resolved' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleAbandon(f.id)} title="废弃"><XCircle className="h-3.5 w-3.5" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(f.id)} title="删除"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-3 border-t mt-4">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>上一页</Button>
            <span className="text-sm text-muted-foreground">{currentPage}/{totalPages} 共{total}条</span>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>下一页</Button>
          </div>
        )}
      </ScrollArea>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) { setEditOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{currentF ? '编辑伏笔' : '添加伏笔'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3"><Label>标题 *</Label><Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} className="mt-1" /></div>
              <div><Label>分类</Label><Input value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="mt-1" placeholder="如：主线" /></div>
            </div>
            <div><Label>内容 *</Label><Textarea rows={3} value={fContent} onChange={(e) => setFContent(e.target.value)} className="mt-1" /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>计划埋入章节</Label><Input type="number" min={1} value={fPlantChapter} onChange={(e) => setFPlantChapter(e.target.value)} className="mt-1" /></div>
              <div><Label>计划回收章节</Label><Input type="number" min={1} value={fTargetChapter} onChange={(e) => setFTargetChapter(e.target.value)} className="mt-1" /></div>
              <div className="flex items-end pb-1"><Switch checked={fIsLongTerm} onCheckedChange={setIsLongTerm} /><span className="ml-2 text-sm">长线伏笔</span></div>
            </div>
            <div><Label>重要性 ({Math.round(fImportance * 10)}/10)</Label><Input type="range" min={0} max={10} step={1} value={Math.round(fImportance * 10)} onChange={(e) => setFImportance(parseInt(e.target.value) / 10)} className="mt-1" /></div>
            <div><Label>暗示文本</Label><Textarea rows={2} value={fHintText} onChange={(e) => setFHintText(e.target.value)} className="mt-1" placeholder="可选" /></div>
            <div><Label>备注</Label><Textarea rows={2} value={fResolutionText} onChange={(e) => setFResolutionText(e.target.value)} className="mt-1" placeholder="可选" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setEditOpen(false); resetForm(); }}>取消</Button><Button onClick={handleSave}>{currentF ? '更新' : '创建'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(o) => !o && setDetailOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>伏笔详情</DialogTitle></DialogHeader>
          {currentF && (
            <div className="space-y-3">
              <h3 className="text-lg font-bold">{currentF.title}</h3>
              <div className="flex gap-2 flex-wrap">
                <Badge variant={STATUS_CONFIG[currentF.status].variant as any}>{STATUS_CONFIG[currentF.status].label}</Badge>
                {currentF.isLongTerm && <Badge variant="outline">长线伏笔</Badge>}
                {currentF.category && <Badge variant="outline">{CATEGORY_CONFIG[currentF.category]?.label || currentF.category}</Badge>}
              </div>
              <Separator />
              <p className="whitespace-pre-wrap text-sm">{currentF.description}</p>
              <div className="grid grid-cols-2 gap-2 text-sm"><span>埋入章节:</span><span>{currentF.plantedChapter ? `第${currentF.plantedChapter}章` : '未设定'}</span><span>计划回收:</span><span>{currentF.targetChapter ? `第${currentF.targetChapter}章` : '未设定'}</span><span>重要性:</span><span>{renderStars(currentF.importance)}</span><span>强度:</span><span>{currentF.strength ?? '-'}/10</span><span>来源:</span><span>{currentF.sourceType === 'analysis' ? '分析提取' : '手动添加'}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
            <Button onClick={() => { setDetailOpen(false); openEditDialog(currentF!); }}>编辑</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plant Dialog */}
      <Dialog open={plantOpen} onOpenChange={(o) => !o && setPlantOpen(false)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>标记伏笔埋入</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div><Label>埋入章节号 *</Label><Input type="number" min={1} value={fPlantChapter} onChange={(e) => setFPlantChapter(e.target.value)} className="mt-1" placeholder="输入章节号" /></div>
            <div><Label>暗示文本（可选）</Label><Textarea rows={3} value={fHintText} onChange={(e) => setFHintText(e.target.value)} className="mt-1" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPlantOpen(false)}>取消</Button><Button onClick={handlePlant}>确认埋入</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={resolveOpen} onOpenChange={(o) => !o && setResolveOpen(false)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>标记伏笔回收</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div><Label>回收章节号 *</Label><Input type="number" min={1} value={fPlantChapter} onChange={(e) => setFPlantChapter(e.target.value)} className="mt-1" /></div>
            <div><Label>揭示文本（可选）</Label><Textarea rows={3} value={fResolutionText} onChange={(e) => setFResolutionText(e.target.value)} className="mt-1" /></div>
            <div className="flex items-center gap-2"><Switch checked={fIsPartial} onCheckedChange={setIsPartial} /><Label>是否部分回收</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setResolveOpen(false)}>取消</Button><Button onClick={handleResolve}>确认回收</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Dialog */}
      <Dialog open={syncOpen} onOpenChange={(o) => !o && setSyncOpen(false)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>手动同步分析伏笔</DialogTitle><DialogDescription>从已完成的分析结果中提取伏笔信息。已存在的记录不会被覆盖。</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setSyncOpen(false)}>取消</Button><Button onClick={handleSync}>开始同步</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
