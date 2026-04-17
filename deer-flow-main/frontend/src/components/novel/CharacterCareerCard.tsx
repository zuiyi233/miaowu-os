'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Edit, Plus, Trash2, Trophy, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { getBackendBaseURL, getAuthHeaders } from '@/core/config';
import type { Career, CharacterCareer } from '@/core/novel/schemas';

interface CareerDetail extends CharacterCareer {
  career_name: string;
}

interface Props {
  characterId: string;
  projectId: string;
  editable?: boolean;
  onUpdate?: () => void;
}

export function CharacterCareerCard({ characterId, projectId, editable = false, onUpdate }: Props) {
  const [mainCareer, setMainCareer] = useState<CareerDetail | null>(null);
  const [subCareers, setSubCareers] = useState<CareerDetail[]>([]);
  const [allCareers, setAllCareers] = useState<Career[]>([]);
  const [loading, setLoading] = useState(true);

  const [isMainModalOpen, setIsMainModalOpen] = useState(false);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [selectedCareer, setSelectedCareer] = useState<CareerDetail | null>(null);

  const [mainForm, setMainForm] = useState({ career_id: '', current_stage: 1, started_at: '' });
  const [subForm, setSubForm] = useState({ career_id: '', current_stage: 1, started_at: '' });
  const [progressForm, setProgressForm] = useState({ current_stage: 1, stage_progress: 0, reached_current_stage_at: '', notes: '' });

  const backendBase = getBackendBaseURL();

  const fetchCharacterCareers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${backendBase}/api/careers/character/${characterId}/careers`, {
        headers: { ...getAuthHeaders() },
      });
      if (!response.ok) throw new Error('获取职业信息失败');
      const data = await response.json();
      setMainCareer(data.main_career || null);
      setSubCareers(data.sub_careers || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取职业信息失败');
    } finally {
      setLoading(false);
    }
  }, [characterId, backendBase]);

  const fetchAllCareers = useCallback(async () => {
    try {
      const response = await fetch(`${backendBase}/api/careers?project_id=${projectId}`, {
        headers: { ...getAuthHeaders() },
      });
      if (!response.ok) return;
      const data = await response.json();
      const main = data.main_careers || [];
      const sub = data.sub_careers || [];
      setAllCareers([...main, ...sub]);
    } catch (error) {
      console.error('获取职业列表失败:', error);
    }
  }, [projectId, backendBase]);

  useEffect(() => {
    fetchCharacterCareers();
    if (editable) fetchAllCareers();
  }, [characterId, editable, fetchCharacterCareers, fetchAllCareers]);

  const handleSetMainCareer = async () => {
    if (!mainForm.career_id) return;
    try {
      const response = await fetch(`${backendBase}/api/careers/character/${characterId}/careers/main`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(mainForm),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '设置主职业失败');
      }
      toast.success('主职业设置成功');
      setIsMainModalOpen(false);
      setMainForm({ career_id: '', current_stage: 1, started_at: '' });
      fetchCharacterCareers();
      onUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置主职业失败');
    }
  };

  const handleAddSubCareer = async () => {
    if (!subForm.career_id) return;
    try {
      const response = await fetch(`${backendBase}/api/careers/character/${characterId}/careers/sub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(subForm),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '添加副职业失败');
      }
      toast.success('副职业添加成功');
      setIsSubModalOpen(false);
      setSubForm({ career_id: '', current_stage: 1, started_at: '' });
      fetchCharacterCareers();
      onUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加副职业失败');
    }
  };

  const handleUpdateProgress = async () => {
    if (!selectedCareer) return;
    try {
      const response = await fetch(
        `${backendBase}/api/careers/character/${characterId}/careers/${selectedCareer.careerId}/stage`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(progressForm),
        }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '更新职业阶段失败');
      }
      toast.success('职业阶段更新成功');
      setIsProgressModalOpen(false);
      setProgressForm({ current_stage: 1, stage_progress: 0, reached_current_stage_at: '', notes: '' });
      fetchCharacterCareers();
      onUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新职业阶段失败');
    }
  };

  const handleRemoveSubCareer = async (careerId: string) => {
    if (!window.confirm('确定要移除这个副职业吗？')) return;

    try {
      const response = await fetch(`${backendBase}/api/careers/character/${characterId}/careers/${careerId}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '删除失败');
      }

      toast.success('副职业删除成功');
      fetchCharacterCareers();
      onUpdate?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除副职业失败');
    }
  };

  const openEditProgress = (career: CareerDetail) => {
    setSelectedCareer(career);
    setProgressForm({
      current_stage: career.currentStage,
      stage_progress: career.stageProgress,
      reached_current_stage_at: career.reachedCurrentStageAt || '',
      notes: career.notes || '',
    });
    setIsProgressModalOpen(true);
  };

  const renderCareerInfo = (career: CareerDetail, isMain: boolean = false) => (
    <div key={career.id} className="mb-4 last:mb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className={cn("w-4 h-4", isMain ? "text-primary" : "text-muted-foreground")} />
          <span className={cn("font-medium", isMain && "font-semibold")}>{career.career_name}</span>
          {isMain && <Badge variant="default" className="bg-blue-500 text-white">主</Badge>}
        </div>
        {editable && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => openEditProgress(career)}>
              <Edit className="w-3.5 h-3.5" />
            </Button>
            {!isMain && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleRemoveSubCareer(career.careerId)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="ml-6 mt-2 space-y-1">
        <p className="text-sm text-muted-foreground">
          {career.stageName}（第{career.currentStage}/{career.maxStage}阶段）
        </p>
        {career.stageDescription && (
          <p className="text-xs text-muted-foreground mt-1">{career.stageDescription}</p>
        )}
        <div className="mt-2">
          <Progress value={career.stageProgress} className="h-1.5" />
          <p className="text-xs text-right mt-0.5 text-muted-foreground">{career.stageProgress}%</p>
        </div>
        {career.startedAt && (
          <p className="text-xs text-muted-foreground">开始时间：{career.startedAt}</p>
        )}
        {career.notes && (
          <p className="text-xs text-muted-foreground mt-1">备注：{career.notes}</p>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>加载中...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            职业信息
          </CardTitle>
          {editable && !mainCareer && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setMainForm({ career_id: '', current_stage: 1, started_at: '' }); setIsMainModalOpen(true); }}
              className="ml-auto"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              设置主职业
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {mainCareer ? (
            <div className="space-y-0">
              {renderCareerInfo(mainCareer, true)}

              {subCareers.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-sm text-muted-foreground mb-2">副职业</p>
                  <div className="space-y-0">
                    {subCareers.map(career => renderCareerInfo(career, false))}
                  </div>
                </>
              )}

              {editable && subCareers.length < 5 && (
                <div className="text-center mt-4">
                  <Button size="sm" variant="outline" onClick={() => { setSubForm({ career_id: '', current_stage: 1, started_at: '' }); setIsSubModalOpen(true); }}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    添加副职业
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-5">暂无职业信息</p>
          )}
        </CardContent>
      </Card>

      {/* 设置主职业 Dialog */}
      <Dialog open={isMainModalOpen} onOpenChange={setIsMainModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置主职业</DialogTitle>
            <DialogDescription>为角色选择一个主职业</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>选择主职业</Label>
              <Select value={mainForm.career_id} onValueChange={(v) => setMainForm(prev => ({ ...prev, career_id: v }))}>
                <SelectTrigger><SelectValue placeholder="选择职业" /></SelectTrigger>
                <SelectContent>
                  {allCareers.filter(c => c.type === 'main').map(career => (
                    <SelectItem key={career.id} value={career.id}>
                      {career.name}（{career.maxStage}个阶段）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>当前阶段</Label>
              <Input type="number" min={1} value={mainForm.current_stage} onChange={(e) => setMainForm(prev => ({ ...prev, current_stage: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label>开始时间</Label>
              <Input placeholder="如：修仙历3000年" value={mainForm.started_at} onChange={(e) => setMainForm(prev => ({ ...prev, started_at: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMainModalOpen(false)}>取消</Button>
            <Button onClick={handleSetMainCareer}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加副职业 Dialog */}
      <Dialog open={isSubModalOpen} onOpenChange={setIsSubModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加副职业</DialogTitle>
            <DialogDescription>为角色添加一个副职业</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>选择副职业</Label>
              <Select value={subForm.career_id} onValueChange={(v) => setSubForm(prev => ({ ...prev, career_id: v }))}>
                <SelectTrigger><SelectValue placeholder="选择职业" /></SelectTrigger>
                <SelectContent>
                  {allCareers.filter(c => c.type === 'sub').map(career => (
                    <SelectItem key={career.id} value={career.id}>
                      {career.name}（{career.maxStage}个阶段）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>当前阶段</Label>
              <Input type="number" min={1} value={subForm.current_stage} onChange={(e) => setSubForm(prev => ({ ...prev, current_stage: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label>开始时间</Label>
              <Input placeholder="如：修仙历3000年" value={subForm.started_at} onChange={(e) => setSubForm(prev => ({ ...prev, started_at: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSubModalOpen(false)}>取消</Button>
            <Button onClick={handleAddSubCareer}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 更新职业进度 Dialog */}
      <Dialog open={isProgressModalOpen} onOpenChange={setIsProgressModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更新职业阶段</DialogTitle>
            <DialogDescription>调整当前职业的进度信息</DialogDescription>
          </DialogHeader>
          {selectedCareer && (
            <div className="space-y-4 py-2">
              <p className="font-medium">职业：{selectedCareer.career_name}</p>
              <Separator />
              <div className="space-y-2">
                <Label>当前阶段</Label>
                <Input type="number" min={1} max={selectedCareer.maxStage} value={progressForm.current_stage} onChange={(e) => setProgressForm(prev => ({ ...prev, current_stage: Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label>阶段进度（0-100）</Label>
                <Input type="number" min={0} max={100} value={progressForm.stage_progress} onChange={(e) => setProgressForm(prev => ({ ...prev, stage_progress: Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label>到达时间</Label>
                <Input placeholder="如：修仙历3001年" value={progressForm.reached_current_stage_at} onChange={(e) => setProgressForm(prev => ({ ...prev, reached_current_stage_at: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>备注</Label>
                <Textarea rows={2} placeholder="如：突破至金丹期" value={progressForm.notes} onChange={(e) => setProgressForm(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProgressModalOpen(false)}>取消</Button>
            <Button onClick={handleUpdateProgress}>更新</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 需要在文件顶部导入 Loader2，但为了简洁这里使用内联方式
function Loader2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
