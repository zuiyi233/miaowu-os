'use client';

import { Trophy, Plus, Pencil, Trash2, Zap, Loader2 } from 'lucide-react';
import { useState, useCallback, useMemo, memo, useRef } from 'react';
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
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAiProviderStore } from '@/core/ai/ai-provider-store';
import {
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  resolveModuleRoutingTarget,
} from '@/core/ai/feature-routing';
import { novelApiService } from '@/core/novel/novel-api';
import { useCareersQuery, useCreateCareerMutation, useUpdateCareerMutation, useDeleteCareerMutation } from '@/core/novel/queries';
import type { Career, CareerStage } from '@/core/novel/schemas';

interface CareersViewProps {
  novelId: string;
}

const CAREERS_MODULE_ID = 'novel-careers';

function parseStages(text: string): CareerStage[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      const match = /^(\d+)\.\s*([^-]+)(?:\s*-\s*(.*))?$/.exec(line);
      if (match) {
        return { level: parseInt(match[1]!), name: (match[2] ?? '').trim(), description: (match[3] ?? '').trim() };
      }
      return { level: index + 1, name: line.trim(), description: '' };
    });
}

const CareerCard = memo(function CareerCard({
  career,
  onEdit,
  onDelete,
}: {
  career: Career;
  onEdit: (career: Career) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="mb-4 transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="h-4 w-4 shrink-0 text-primary" />
            <CardTitle className="text-base truncate">{career.name}</CardTitle>
            <Badge variant={career.source === 'ai' ? 'default' : 'secondary'} className="shrink-0">
              {career.source === 'ai' ? 'AI生成' : '手动创建'}
            </Badge>
            {career.category && (
              <Badge variant="outline" className="shrink-0">{career.category}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(career)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(career.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground line-clamp-2">{career.description || '暂无描述'}</p>
        <Separator className="my-3" />
        <p className="text-sm font-medium mb-2">阶段体系（共{career.maxStage}个）：</p>
        <div className="max-h-[120px] overflow-y-auto space-y-1 pl-2">
          {career.stages.slice(0, 5).map((stage) => (
            <p key={stage.level} className="text-xs text-muted-foreground">
              {stage.level}. {stage.name}
              {stage.description && <span className="ml-1">- {stage.description}</span>}
            </p>
          ))}
          {career.stages.length > 5 && (
            <p className="text-xs text-muted-foreground pl-2">...还有{career.stages.length - 5}个阶段</p>
          )}
        </div>
        {career.specialAbilities && (
          <>
            <Separator className="my-3" />
            <p className="text-sm font-medium">特殊能力：</p>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{career.specialAbilities}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
});

export function CareersView({ novelId }: CareersViewProps) {
  const providers = useAiProviderStore((state) => state.effective.providers);
  const featureRoutingSettings = useAiProviderStore((state) => state.effective.featureRoutingSettings);
  const modelRoutingPayload = useMemo(() => {
    const routingRaw = featureRoutingSettings ?? loadFeatureRoutingState(providers);
    const routing = normalizeFeatureRoutingState(routingRaw, providers);
    const resolved = resolveModuleRoutingTarget(routing, CAREERS_MODULE_ID);
    const target = resolved?.target ?? routing.defaultTarget;
    return {
      module_id: CAREERS_MODULE_ID,
      ...(target?.providerId ? { ai_provider_id: target.providerId } : {}),
      ...(target?.model ? { ai_model: target.model } : {}),
    };
  }, [featureRoutingSettings, providers]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [editingCareer, setEditingCareer] = useState<Career | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'main' | 'sub'>('main');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formStages, setFormStages] = useState('');
  const [formRequirements, setFormRequirements] = useState('');
  const [formSpecialAbilities, setFormSpecialAbilities] = useState('');
  const [formWorldviewRules, setFormWorldviewRules] = useState('');

  const [aiMainCount, setAiMainCount] = useState(3);
  const [aiSubCount, setAiSubCount] = useState(5);
  const [aiRequirements, setAiRequirements] = useState('');

  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiMessage, setAiMessage] = useState('');
  const aiReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const { data: careersData, refetch: refetchCareers } = useCareersQuery(novelId, modelRoutingPayload);
  const createMutation = useCreateCareerMutation();
  const updateMutation = useUpdateCareerMutation();
  const deleteMutation = useDeleteCareerMutation();

  const mainCareers = careersData?.mainCareers ?? [];
  const subCareers = careersData?.subCareers ?? [];

  const resetForm = useCallback(() => {
    setFormName('');
    setFormType('main');
    setFormDescription('');
    setFormCategory('');
    setFormStages('');
    setFormRequirements('');
    setFormSpecialAbilities('');
    setFormWorldviewRules('');
    setEditingCareer(null);
  }, []);

  const openCreateDialog = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const openEditDialog = (career: Career) => {
    setEditingCareer(career);
    setFormName(career.name);
    setFormType(career.type);
    setFormDescription(career.description ?? '');
    setFormCategory(career.category ?? '');
    setFormStages(
      career.stages.map((s) => `${s.level}. ${s.name}${s.description ? ` - ${s.description}` : ''}`).join('\n'),
    );
    setFormRequirements(career.requirements ?? '');
    setFormSpecialAbilities(career.specialAbilities ?? '');
    setFormWorldviewRules(career.worldviewRules ?? '');
    setIsCreateOpen(true);
  };

  const handleOpenEdit = useCallback((career: Career) => {
    openEditDialog(career);
  }, []);

  const handleDeleteCareer = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error('请输入职业名称');
      return;
    }

    const stages = parseStages(formStages);
    const payload = {
      project_id: novelId,
      name: formName,
      type: formType,
      description: formDescription || undefined,
      category: formCategory || undefined,
      stages,
      max_stage: stages.length,
      requirements: formRequirements || undefined,
      special_abilities: formSpecialAbilities || undefined,
      worldview_rules: formWorldviewRules || undefined,
      source: 'manual',
    };

    try {
      if (editingCareer) {
        await updateMutation.mutateAsync({
          careerId: editingCareer.id,
          data: {
            ...payload,
            ...modelRoutingPayload,
          },
        });
        toast.success('职业更新成功');
      } else {
        await createMutation.mutateAsync({
          ...payload,
          ...modelRoutingPayload,
        });
        toast.success('职业创建成功');
      }
      setIsCreateOpen(false);
      resetForm();
    } catch {
      toast.error(editingCareer ? '更新失败' : '创建失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget);
      toast.success('职业删除成功');
      setDeleteTarget(null);
    } catch {
      toast.error('删除失败');
    }
  };

  const handleAIGenerate = async () => {
    setIsAIOpen(false);
    setAiGenerating(true);
    setAiProgress(0);
    setAiMessage('开始生成新职业...');

    try {
      const response = await novelApiService.generateCareerSystem(novelId, {
        mainCareerCount: aiMainCount,
        subCareerCount: aiSubCount,
        userRequirements: aiRequirements || undefined,
      }, modelRoutingPayload);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      aiReaderRef.current = reader;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter((l) => l.startsWith('data:'));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.type === 'progress') {
              setAiProgress(data.progress ?? 0);
              setAiMessage(data.message ?? '');
            } else if (data.type === 'done') {
              setAiGenerating(false);
              toast.success('AI新职业生成完成！');
              refetchCareers();
              return;
            } else if (data.type === 'error') {
              setAiGenerating(false);
              toast.error(data.message || '生成失败');
              return;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      setAiGenerating(false);
      aiReaderRef.current = null;
      toast.error('连接中断，生成失败');
    }
  };

  const cancelAiGenerate = useCallback(() => {
    aiReaderRef.current?.cancel().catch(() => {});
    aiReaderRef.current = null;
    setAiGenerating(false);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          职业管理
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsAIOpen(true)}>
            <Zap className="h-4 w-4 mr-1" />
            AI生成新职业
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-1" />
            新增职业
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-4">
        <Tabs defaultValue="main" className="w-full">
          <TabsList>
            <TabsTrigger value="main">
              主职业 <Badge variant="secondary" className="ml-1">{mainCareers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="sub">
              副职业 <Badge variant="secondary" className="ml-1">{subCareers.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="mt-4">
            {mainCareers.length > 0 ? mainCareers.map((career) => (
              <CareerCard key={career.id} career={career} onEdit={handleOpenEdit} onDelete={handleDeleteCareer} />
            )) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Trophy className="h-12 w-12 mb-3 opacity-30" />
                <p>还没有主职业</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openCreateDialog}>添加第一个主职业</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="sub" className="mt-4">
            {subCareers.length > 0 ? subCareers.map((career) => (
              <CareerCard key={career.id} career={career} onEdit={handleOpenEdit} onDelete={handleDeleteCareer} />
            )) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Trophy className="h-12 w-12 mb-3 opacity-30" />
                <p>还没有副职业</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openCreateDialog}>添加第一个副职业</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) { setIsCreateOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCareer ? '编辑职业' : '新增职业'}</DialogTitle>
            <DialogDescription>{editingCareer ? '修改职业信息' : '创建一个新的职业体系'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3">
                <Label htmlFor="name">职业名称 *</Label>
                <Input id="name" placeholder="如：剑修、炼丹师" value={formName} onChange={(e) => setFormName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="type">类型</Label>
                <Select value={formType} onValueChange={(v) => setFormType(v as 'main' | 'sub')}>
                  <SelectTrigger id="type" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">主职业</SelectItem>
                    <SelectItem value="sub">副职业</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="description">职业描述</Label>
              <Textarea id="description" rows={2} placeholder="描述这个职业..." value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="mt-1" />
            </div>

            <div>
              <Label htmlFor="category">职业分类</Label>
              <Input id="category" placeholder="如：战斗系、生产系、辅助系" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="mt-1" />
            </div>

            <div>
              <Label htmlFor="stages">职业阶段</Label>
              <Textarea id="stages" rows={6} placeholder={"示例：\n1. 炼气期 - 初窥门径\n2. 筑基期 - 根基稳固\n3. 金丹期 - 凝结金丹"} value={formStages} onChange={(e) => setFormStages(e.target.value)} className="mt-1 font-mono text-sm" />
              <p className="text-xs text-muted-foreground mt-1">每行一个阶段，格式：1. 阶段名 - 描述</p>
            </div>

            <div>
              <Label htmlFor="requirements">职业要求</Label>
              <Textarea id="requirements" rows={2} placeholder="需要什么条件才能修炼..." value={formRequirements} onChange={(e) => setFormRequirements(e.target.value)} className="mt-1" />
            </div>

            <div>
              <Label htmlFor="specialAbilities">特殊能力</Label>
              <Textarea id="specialAbilities" rows={2} placeholder="这个职业的特殊能力..." value={formSpecialAbilities} onChange={(e) => setFormSpecialAbilities(e.target.value)} className="mt-1" />
            </div>

            <div>
              <Label htmlFor="worldviewRules">世界观规则</Label>
              <Textarea id="worldviewRules" rows={2} placeholder="如何融入世界观..." value={formWorldviewRules} onChange={(e) => setFormWorldviewRules(e.target.value)} className="mt-1" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>取消</Button>
            <Button onClick={handleSubmit}>{editingCareer ? '更新' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Generate Dialog */}
      <Dialog open={isAIOpen} onOpenChange={(open) => !open && setIsAIOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI生成新职业（增量式）</DialogTitle>
            <DialogDescription>AI将分析当前世界观和已有职业，智能生成新的补充职业。可以多次生成，逐步完善职业体系，不会替换已有职业。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="aiMainCount">本次新增主职业数量</Label>
              <Input id="aiMainCount" type="number" min={1} max={10} value={aiMainCount} onChange={(e) => setAiMainCount(parseInt(e.target.value) || 3)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="aiSubCount">本次新增副职业数量</Label>
              <Input id="aiSubCount" type="number" min={0} max={15} value={aiSubCount} onChange={(e) => setAiSubCount(parseInt(e.target.value) || 5)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="aiRequirements">额外要求（可选）</Label>
              <Textarea id="aiRequirements" rows={4} maxLength={500} placeholder="例如：希望新增一个偏情报收集与潜伏渗透的主职业；副职业偏医术、经营或制造方向；避免再出现纯正面战斗型职业。" value={aiRequirements} onChange={(e) => setAiRequirements(e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">可描述希望新增的职业方向、能力侧重、限制条件等</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAIOpen(false)}>取消</Button>
            <Button onClick={handleAIGenerate}><Zap className="h-4 w-4 mr-1" />开始生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除这个职业吗？如果有角色使用了该职业，将无法删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Progress Overlay */}
      {aiGenerating && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <Card className="w-96 p-6 shadow-xl">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="font-medium">AI生成新职业中...</p>
              </div>
              <Progress value={aiProgress} />
              <p className="text-sm text-muted-foreground">{aiMessage}</p>
              <Button variant="outline" size="sm" onClick={cancelAiGenerate}>取消</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
