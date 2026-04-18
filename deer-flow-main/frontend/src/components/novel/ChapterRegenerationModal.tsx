'use client';

import { RefreshCcw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

import { SSEProgressModal } from './SSEProgressModal';

interface Suggestion {
  category: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
}

interface ChapterRegenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newContent: string, wordCount: number) => void;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  suggestions?: Suggestion[];
  hasAnalysis: boolean;
}

async function streamRegenerate(
  url: string,
  body: Record<string, unknown>,
  callbacks: {
    onProgress: (progress: number, wordCount?: number) => void;
    onChunk: (chunk: string) => void;
    onResult: (data: Record<string, unknown>) => void;
    onError: (error: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const backendBase = getBackendBaseURL();
  const response = await fetch(`${backendBase}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No body');
  const decoder = new TextDecoder();
  let buffer = '';
  let aborted = false;

  const parseSseBlock = (rawBlock: string) => {
    const dataLines = rawBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      return;
    }

    const payload = dataLines.join('\n');
    if (!payload || payload === '[DONE]') {
      return;
    }

    try {
      const data = JSON.parse(payload);
      if (data.type === 'progress') {
        callbacks.onProgress(data.progress || 0, data.word_count);
      } else if (data.type === 'chunk' && data.content) {
        callbacks.onChunk(data.content);
      } else if (data.type === 'result') {
        callbacks.onResult(data.data || {});
      } else if (data.type === 'error') {
        callbacks.onError(data.error || data.message || 'Error');
      }
    } catch {
      // Ignore invalid SSE JSON chunks to keep stream resilient.
    }
  };

  try {
    while (true) {
      if (signal?.aborted) { aborted = true; break; }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.forEach((block) => parseSseBlock(block));
    }

    if (!aborted) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        const blocks = buffer.split('\n\n').filter(Boolean);
        blocks.forEach((block) => parseSseBlock(block));
      }
    }
  } finally {
    reader.releaseLock();
    if (aborted || signal?.aborted) {
      response.body?.cancel().catch(() => {});
    }
  }
}

function buildRegenerationRequirements(
  modSource: 'custom' | 'analysis_suggestions' | 'mixed',
  suggestions: Suggestion[],
  selectedSuggestions: number[],
  customInstructions: string,
  preserveStructure: boolean,
  preserveCharacterTraits: boolean,
  focusAreas: string[],
) {
  const selectedSuggestionTexts = selectedSuggestions
    .map((index) => suggestions[index])
    .filter((item): item is Suggestion => Boolean(item))
    .map((item) => `- [${item.priority}/${item.category}] ${item.content}`);

  const focusAreaMap: Record<string, string> = {
    pacing: '节奏把控',
    emotion: '情感渲染',
    description: '场景描写',
    dialogue: '对话质量',
    conflict: '冲突强度',
  };
  const focusText = focusAreas.map((area) => focusAreaMap[area] || area).join('、');

  const lines = [
    '请在保持章节主线连贯的前提下，对当前章节进行完整重写优化。',
    `修改模式：${modSource}`,
    `保留结构：${preserveStructure ? '是' : '否'}`,
    `保持角色一致性：${preserveCharacterTraits ? '是' : '否'}`,
  ];

  if (selectedSuggestionTexts.length > 0) {
    lines.push('请重点落实以下分析建议：');
    lines.push(...selectedSuggestionTexts);
  }

  if (customInstructions.trim()) {
    lines.push(`额外自定义要求：${customInstructions.trim()}`);
  }

  if (focusText) {
    lines.push(`重点优化方向：${focusText}`);
  }

  return lines.join('\n');
}

export function ChapterRegenerationModal({
  open,
  onOpenChange,
  onSuccess,
  chapterId,
  chapterTitle,
  chapterNumber,
  suggestions = [],
  hasAnalysis,
}: ChapterRegenerationModalProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<number[]>([]);
  const [modSource, setModSource] = useState<'custom' | 'analysis_suggestions' | 'mixed'>(
    hasAnalysis && suggestions.length > 0 ? 'mixed' : 'custom'
  );
  const [customInstructions, setCustomInstructions] = useState('');
  const [targetWordCount, setTargetWordCount] = useState(3000);
  const [preserveStructure, setPreserveStructure] = useState(false);
  const [preserveCharacterTraits, setPreserveCharacterTraits] = useState(true);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chunkFlushRafRef = useRef<number | null>(null);
  const chunkWordCountRef = useRef(0);

  useEffect(() => {
    if (open) {
      setStatus('idle'); setProgress(0); setErrorMsg(''); setWordCount(0);
      setSelectedSuggestions([]);
      setModSource(hasAnalysis && suggestions.length > 0 ? 'mixed' : 'custom');
      setCustomInstructions(''); setTargetWordCount(3000);
      setPreserveStructure(false); setPreserveCharacterTraits(true);
      setFocusAreas([]);
      chunkWordCountRef.current = 0;
      if (chunkFlushRafRef.current !== null) {
        window.cancelAnimationFrame(chunkFlushRafRef.current);
        chunkFlushRafRef.current = null;
      }
    }
  }, [open, hasAnalysis, suggestions.length]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (chunkFlushRafRef.current !== null) {
        window.cancelAnimationFrame(chunkFlushRafRef.current);
        chunkFlushRafRef.current = null;
      }
    };
  }, []);

  const toggleSuggestion = (idx: number, checked: boolean) => {
    setSelectedSuggestions((prev) => checked ? [...prev, idx] : prev.filter((i) => i !== idx));
  };

  const toggleFocus = (area: string) => {
    setFocusAreas((prev) => prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]);
  };

  const handleSubmit = async () => {
    if (modSource === 'custom' && !customInstructions.trim()) { toast.error('请输入自定义修改要求'); return; }
    if (modSource === 'analysis_suggestions' && selectedSuggestions.length === 0) { toast.error('请选择至少一条分析建议'); return; }
    if (modSource === 'mixed' && selectedSuggestions.length === 0 && !customInstructions.trim()) { toast.error('请至少选择一条建议或输入自定义要求'); return }

    setLoading(true); setStatus('generating'); setProgress(0); setWordCount(0);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let accumulated = '';
    const requirements = buildRegenerationRequirements(
      modSource,
      suggestions,
      selectedSuggestions,
      customInstructions,
      preserveStructure,
      preserveCharacterTraits,
      focusAreas,
    );

    const flushWordCount = () => {
      if (chunkFlushRafRef.current !== null) {
        return;
      }
      chunkFlushRafRef.current = window.requestAnimationFrame(() => {
        chunkFlushRafRef.current = null;
        setWordCount(chunkWordCountRef.current);
      });
    };

    try {
      await streamRegenerate(`/api/chapters/${chapterId}/generate-stream`, {
        target_word_count: targetWordCount,
        requirements,
      }, {
        onProgress: (prog, wc) => {
          setProgress(prog);
          if (wc) {
            setWordCount(wc);
          }
        },
        onChunk: (chunk) => {
          accumulated += chunk;
          chunkWordCountRef.current = accumulated.length;
          flushWordCount();
        },
        onResult: (data) => {
          setProgress(100); setStatus('success');
          if (chunkFlushRafRef.current !== null) {
            window.cancelAnimationFrame(chunkFlushRafRef.current);
            chunkFlushRafRef.current = null;
          }
          const finalWc = (data as { word_count?: number }).word_count || accumulated.length;
          setWordCount(finalWc);
          toast.success('重新生成完成！');
          setTimeout(() => onSuccess(accumulated, finalWc), 500);
        },
        onError: (err) => { setStatus('error'); setErrorMsg(err); toast.error('重新生成失败: ' + err); },
      }, abortController.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setErrorMsg('');
        toast.info('已取消重新生成');
      } else {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : '未知错误');
        toast.error('操作失败');
      }
    } finally {
      if (chunkFlushRafRef.current !== null) {
        window.cancelAnimationFrame(chunkFlushRafRef.current);
        chunkFlushRafRef.current = null;
      }
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (loading) {
      if (!window.confirm('生成正在进行中，确定要取消吗？')) return;
      abortControllerRef.current?.abort();
      setLoading(false);
      setStatus('idle');
    }
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>重新生成章节 — 第{chapterNumber}章：{chapterTitle}</DialogTitle>
            <DialogDescription>基于AI分析建议或自定义指令重新生成章节内容</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4 -mr-4">
            <div className="space-y-4 py-2">
              {status === 'success' && (
                <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>重新生成成功！共生成 {wordCount} 字</AlertDescription></Alert>
              )}
              {status === 'error' && (
                <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertDescription>{errorMsg}</AlertDescription></Alert>
              )}

              {/* Modification Source */}
              <div className="space-y-1.5">
                <Label>修改来源</Label>
                <div className="flex gap-2">
                  {(() => {
                    const opts = ['custom'];
                    if (hasAnalysis && suggestions.length > 0) opts.push('analysis_suggestions', 'mixed');
                    return opts.map((v) => (
                      <Button
                        key={v}
                        type="button"
                        variant={modSource === v ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setModSource(v as typeof modSource)}
                      >
                        {{ custom: '仅自定义', analysis_suggestions: '仅分析建议', mixed: '混合模式' }[v]}
                      </Button>
                    ));
                  })()}
                </div>
              </div>

              {/* Suggestions */}
              {hasAnalysis && suggestions.length > 0 && (modSource === 'analysis_suggestions' || modSource === 'mixed') && (
                <div className="space-y-1.5">
                  <Label>选择分析建议 ({selectedSuggestions.length}/{suggestions.length})</Label>
                  <div className="rounded-md border p-3 max-h-[200px] overflow-y-auto space-y-2">
                    {suggestions.map((s, idx) => (
                      <label key={idx} className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                        <Checkbox checked={selectedSuggestions.includes(idx)} onCheckedChange={(c) => toggleSuggestion(idx, !!c)} className="mt-0.5" />
                        <span className="flex-1 text-sm">
                          <Badge variant={s.priority === 'high' ? 'destructive' : s.priority === 'medium' ? 'outline' : 'secondary'} className="mr-1.5 text-[10px]">
                            {s.category}
                          </Badge>
                          {s.content}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Instructions */}
              {(modSource === 'custom' || modSource === 'mixed') && (
                <div className="space-y-1.5">
                  <Label htmlFor="custom-inst">自定义修改要求</Label>
                  <Textarea id="custom-inst" rows={3} placeholder="例如：增强情感渲染，让主角的内心戏更加细腻..." maxLength={1000} value={customInstructions} onChange={(e) => setCustomInstructions(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground text-right">{customInstructions.length}/1000</p>
                </div>
              )}

              {/* Advanced Options */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> 高级选项
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pt-3 space-y-3 pl-2 border-l-2 ml-1">
                    <div>
                      <Label className="text-xs">重点优化方向</Label>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {['pacing', 'emotion', 'description', 'dialogue', 'conflict'].map((area) => (
                          <Badge key={area} variant={focusAreas.includes(area) ? 'default' : 'outline'} className="cursor-pointer select-none" onClick={() => toggleFocus(area)}>
                            {{ pacing: '节奏把控', emotion: '情感渲染', description: '场景描写', dialogue: '对话质量', conflict: '冲突强度' }[area]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <Label className="text-xs">保留元素</Label>
                      <label className="flex items-center gap-2"><Checkbox checked={preserveStructure} onCheckedChange={(c) => setPreserveStructure(!!c)} /><span className="text-sm">保留整体结构和情节框架</span></label>
                      <label className="flex items-center gap-2"><Checkbox checked={preserveCharacterTraits} onCheckedChange={(c) => setPreserveCharacterTraits(!!c)} /><span className="text-sm">保持角色性格一致</span></label>
                    </div>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label htmlFor="target-wc" className="text-xs">目标字数</Label>
                      <Input id="target-wc" type="number" min={500} max={10000} step={500} value={targetWordCount} onChange={(e) => setTargetWordCount(Number(e.target.value))} />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4 border-t">
            <Button variant="outline" onClick={handleCancel} disabled={loading}>取消</Button>
            <Button onClick={handleSubmit} disabled={loading || status === 'success'}>
              <RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
              开始重新生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SSEProgressModal open={status === 'generating'} onOpenChange={() => {}} progress={progress} message={`正在重新生成中... (已生成 ${wordCount} 字)`} title="重新生成章节" showPercentage onCancel={handleCancel} cancelButtonText="中断" />
    </>
  );
}
