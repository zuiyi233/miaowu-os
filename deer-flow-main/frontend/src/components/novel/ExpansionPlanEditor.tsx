'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getBackendBaseURL, getAuthHeaders } from '@/core/config';

export interface ExpansionPlanData {
  summary?: string;
  key_events?: string[];
  character_focus?: string[];
  emotional_tone?: string;
  narrative_goal?: string;
  conflict_type?: string;
  estimated_words?: number;
  scenes?: unknown[] | null;
}

interface ExpansionPlanEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planData: ExpansionPlanData | null;
  chapterSummary: string | null;
  projectId: string;
  onSave: (data: ExpansionPlanData & { summary?: string }) => Promise<void>;
}

export function ExpansionPlanEditor({
  open,
  onOpenChange,
  planData,
  chapterSummary,
  projectId,
  onSave,
}: ExpansionPlanEditorProps) {
  const [loading, setLoading] = useState(false);
  const [keyEventInput, setKeyEventInput] = useState('');
  const [keyEvents, setKeyEvents] = useState<string[]>([]);
  const [availableCharacters, setAvailableCharacters] = useState<Array<{ name: string; id: string }>>([]);
  const [characters, setCharacters] = useState<string[]>([]);
  const [loadingChars, setLoadingChars] = useState(false);

  // Form state
  const [summary, setSummary] = useState('');
  const [emotionalTone, setEmotionalTone] = useState('紧张激烈');
  const [narrativeGoal, setNarrativeGoal] = useState('');
  const [conflictType, setConflictType] = useState('人物冲突');
  const [estimatedWords, setEstimatedWords] = useState(3000);

  const loadCharacters = useCallback(async () => {
    try {
      setLoadingChars(true);
      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/projects/${projectId}/characters`, {
        headers: { ...getAuthHeaders() },
      });
      if (!response.ok) throw new Error('加载角色失败');
      const data = await response.json();
      const chars = Array.isArray(data)
        ? data.map((c: Record<string, unknown>) => ({ name: String(c.name), id: String(c.id) }))
        : Array.isArray(data.items)
          ? data.items.map((c: Record<string, unknown>) => ({ name: String(c.name), id: String(c.id) }))
          : [];
      setAvailableCharacters(chars);
    } catch (error) {
      console.error('加载角色列表失败:', error);
      setAvailableCharacters([]);
    } finally {
      setLoadingChars(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) loadCharacters();
  }, [open, projectId, loadCharacters]);

  useEffect(() => {
    if (open) {
      if (planData) {
        setKeyEvents(planData.key_events || []);
        setCharacters(planData.character_focus || []);
        setSummary(chapterSummary || planData.summary || '');
        setEmotionalTone(planData.emotional_tone || '紧张激烈');
        setNarrativeGoal(planData.narrative_goal || '');
        setConflictType(planData.conflict_type || '人物冲突');
        setEstimatedWords(planData.estimated_words || 3000);
      } else {
        resetForm();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planData, chapterSummary, open]);

  const resetForm = () => {
    setKeyEvents([]);
    setCharacters([]);
    setKeyEventInput('');
    setSummary(chapterSummary || '');
    setEmotionalTone('紧张激烈');
    setNarrativeGoal('');
    setConflictType('人物冲突');
    setEstimatedWords(3000);
  };

  const handleAddKeyEvent = () => {
    if (keyEventInput.trim()) {
      setKeyEvents([...keyEvents, keyEventInput.trim()]);
      setKeyEventInput('');
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      if (keyEvents.length === 0) { toast.warning('请至少添加一个关键事件'); setLoading(false); return; }
      if (characters.length === 0) { toast.warning('请至少添加一个涉及角色'); setLoading(false); return; }

      const updatedPlan: ExpansionPlanData & { summary?: string } = {
        summary,
        key_events: keyEvents,
        character_focus: characters,
        emotional_tone: emotionalTone,
        narrative_goal: narrativeGoal,
        conflict_type: conflictType,
        estimated_words: estimatedWords,
        scenes: planData?.scenes || null,
      };
      await onSave(updatedPlan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const unusedChars = availableCharacters.filter((c) => !characters.includes(c.name));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>编辑章节规划</DialogTitle>
          <DialogDescription>为当前章节设置详细的写作规划</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-5 py-2">
            {/* 情节概要 */}
            <div className="space-y-1.5">
              <Label>情节概要</Label>
              <Textarea
                placeholder="简要描述本章的主要情节..."
                rows={3}
                maxLength={500}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground text-right">{summary.length}/500</p>
            </div>

            <Separator />

            {/* 关键事件 */}
            <div className="space-y-1.5">
              <Label>关键事件 <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input
                  placeholder="输入关键事件后按回车或点击添加"
                  value={keyEventInput}
                  onChange={(e) => setKeyEventInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyEvent(); } }}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddKeyEvent} disabled={!keyEventInput.trim()}>
                  <Plus className="w-3.5 h-3.5 mr-1" />添加
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keyEvents.map((event, idx) => (
                  <Badge key={idx} variant="secondary" className="gap-1 pr-1 bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    <span className="font-bold text-[10px]">#{idx + 1}</span>
                    {event}
                    <button
                      className="ml-1 hover:bg-purple-200 dark:hover:bg-purple-800 rounded p-0.5"
                      onClick={() => setKeyEvents(keyEvents.filter((_, i) => i !== idx))}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* 涉及角色 */}
            <div className="space-y-1.5">
              <Label>涉及角色 <span className="text-destructive">*</span></Label>
              <Select
                value=""
                onValueChange={(v) => v && !characters.includes(v) && setCharacters([...characters, v])}
              >
                <SelectTrigger><SelectValue placeholder="选择角色..." /></SelectTrigger>
                <SelectContent>
                  {loadingChars ? (
                    <SelectItem value="_loading" disabled>加载中...</SelectItem>
                  ) : unusedChars.length > 0 ? (
                    unusedChars.map((char) => (
                      <SelectItem key={char.id} value={char.name}>{char.name}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="_empty" disabled>{availableCharacters.length === 0 ? '暂无角色' : '所有角色已添加'}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {characters.map((name, idx) => (
                  <Badge key={idx} variant="secondary" className="gap-1 pr-1 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
                    {name}
                    <button
                      className="ml-1 hover:bg-cyan-200 dark:hover:bg-cyan-800 rounded p-0.5"
                      onClick={() => setCharacters(characters.filter((_, i) => i !== idx))}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* 情感基调 / 冲突类型 / 预估字数 */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>情感基调</Label>
                <Input
                  placeholder="如：紧张激烈"
                  maxLength={20}
                  value={emotionalTone}
                  onChange={(e) => setEmotionalTone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>冲突类型</Label>
                <Input
                  placeholder="如：人物冲突"
                  maxLength={20}
                  value={conflictType}
                  onChange={(e) => setConflictType(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>预估字数</Label>
                <Input
                  type="number"
                  min={500}
                  max={10000}
                  step={100}
                  value={estimatedWords}
                  onChange={(e) => setEstimatedWords(Number(e.target.value))}
                />
              </div>
            </div>

            {/* 叙事目标 */}
            <div className="space-y-1.5">
              <Label>叙事目标</Label>
              <Textarea
                placeholder="描述本章要达成的叙事目标..."
                rows={3}
                maxLength={500}
                value={narrativeGoal}
                onChange={(e) => setNarrativeGoal(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground text-right">{narrativeGoal.length}/500</p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={handleClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <span className="animate-spin mr-2">⏳</span>}
            保存规划
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
