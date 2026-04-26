'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Play, RefreshCw, X, RotateCcw,
  AlertTriangle, Redo, Inbox, CheckCircle, FileText,
  Loader2, ChevronRight, BookOpen, Settings
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAiProviderStore } from '@/core/ai/ai-provider-store';
import {
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  resolveModuleRoutingTarget,
} from '@/core/ai/feature-routing';
import { novelApiService } from '@/core/novel/novel-api';
import type { AiModelRoutingPayload } from '@/core/novel/novel-api';
import type { BookImportPreview, BookImportChapter, BookImportStepFailure } from '@/core/novel/schemas';
import { cn } from '@/lib/utils';

type PageStep = 'upload' | 'parsing' | 'preview' | 'applying';

const CACHE_KEY = 'book_import_page_cache_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BOOK_IMPORT_MODULE_ID = 'novel-book-import';

interface CacheState {
  taskId: string;
  taskStatus: string;
  preview: BookImportPreview | null;
  applyProgress: number;
  applyStatus: string;
  applyError: string | null;
  failedSteps: BookImportStepFailure[];
  retrying: boolean;
  pageStep: PageStep;
}

function loadCache(): CacheState | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CacheState & { _ts: number };
    if (Date.now() - data._ts > CACHE_TTL_MS) { sessionStorage.removeItem(CACHE_KEY); return null; }
    delete (data as any)._ts;
    return data;
  } catch { return null; }
}

function saveCache(state: Partial<CacheState>) {
  sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...state, _ts: Date.now() }));
}

function clearCache() { sessionStorage.removeItem(CACHE_KEY); }

export function BookImportPage() {
  const router = useRouter();
  const providers = useAiProviderStore((state) => state.effective.providers);
  const featureRoutingSettings = useAiProviderStore((state) => state.effective.featureRoutingSettings);

  const modelRoutingPayload: AiModelRoutingPayload = useMemo(() => {
    const routingRaw = featureRoutingSettings ?? loadFeatureRoutingState(providers);
    const routing = normalizeFeatureRoutingState(routingRaw, providers);
    const resolved = resolveModuleRoutingTarget(routing, BOOK_IMPORT_MODULE_ID);
    const target = resolved?.target ?? routing.defaultTarget;
    return {
      module_id: BOOK_IMPORT_MODULE_ID,
      ...(target?.providerId ? { ai_provider_id: target.providerId } : {}),
      ...(target?.model ? { ai_model: target.model } : {}),
    };
  }, [featureRoutingSettings, providers]);

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseRange, setParseRange] = useState<'tail' | 'full'>('tail');
  const [tailChapters, setTailChapters] = useState(20);

  // Task state
  const [taskId, setTaskId] = useState<string>('');
  const [taskStatus, setTaskStatus] = useState('');
  const [parseProgress, setParseProgress] = useState(0);
  const [pollTimer, setPollTimer] = useState<NodeJS.Timeout | null>(null);

  // Preview state
  const [preview, setPreview] = useState<BookImportPreview | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectType, setProjectType] = useState('');
  const [projectTheme, setProjectTheme] = useState('');
  const [projectSummary, setProjectSummary] = useState('');
  const [narrativeAngle, setNarrativeAngle] = useState('');
  const [targetWordCount, setTargetWordCount] = useState(50000);
  const [chapters, setChapters] = useState<BookImportChapter[]>([]);

  const chapterVirtualizer = useVirtualizer({
    count: chapters.length,
    getScrollElement: () => chapterListRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  // Apply state
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [failedSteps, setFailedSteps] = useState<BookImportStepFailure[]>([]);
  const [retrying, setRetrying] = useState(false);

  // UI state
  const [pageStep, setPageStep] = useState<PageStep>('upload');

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // Load cache on mount
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setTaskId(cached.taskId ?? '');
      setTaskStatus(cached.taskStatus ?? '');
      setPreview(cached.preview);
      setApplyProgress(cached.applyProgress ?? 0);
      setApplyStatus(cached.applyStatus ?? '');
      setApplyError(cached.applyError ?? null);
      setFailedSteps(cached.failedSteps ?? []);
      setRetrying(cached.retrying ?? false);
      setPageStep(cached.pageStep ?? 'upload');
      if (cached.preview?.chapters) setChapters(cached.preview.chapters);
    }
  }, []);

  const updateCache = useCallback((patch: Partial<CacheState>) => {
    const state: Partial<CacheState> = {
      taskId, taskStatus, preview, applyProgress, applyStatus, applyError, failedSteps, retrying, pageStep, ...patch,
    };
    saveCache(state);
  }, [taskId, taskStatus, preview, applyProgress, applyStatus, applyError, failedSteps, retrying, pageStep]);

  const resetAll = useCallback(() => {
    clearCache();
    if (pollTimer) clearInterval(pollTimer);
    setFile(null); setDragOver(false);
    setTaskId(''); setTaskStatus(''); setParseProgress(0); setPollTimer(null);
    setPreview(null); setChapters([]);
    setProjectTitle(''); setProjectType(''); setProjectTheme('');
    setProjectSummary(''); setNarrativeAngle(''); setTargetWordCount(50000);
    setApplyProgress(0); setApplyStatus(''); setApplyError(null);
    setFailedSteps([]); setRetrying(false);
    setPageStep('upload');
  }, [pollTimer]);

  // --- File handling ---
  const handleFilePick = (f: File) => {
    if (!f.name.endsWith('.txt')) { toast.error('仅支持 .txt 文件'); return; }
    if (f.size > 50 * 1024 * 1024) { toast.error('文件过大，建议 ≤50MB'); return; }
    setFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFilePick(f);
  };

  // --- Start parsing ---
  const startParsing = async () => {
    if (!file) { toast.error('请先上传文件'); return; }

    try {
      const result = await novelApiService.createBookImportTask(file, {
        extractMode: parseRange,
        tailChapterCount: tailChapters,
      }, modelRoutingPayload);

      const tid = result.taskId;
      if (!tid) throw new Error('No task ID returned');
      setTaskId(tid);
      setPageStep('parsing');
      setTaskStatus('pending');
      setParseProgress(0);
      updateCache({ taskId: tid, taskStatus: 'pending', pageStep: 'parsing' });

      pollStatus(tid);
    } catch (err: any) {
      toast.error(err.message || '创建解析任务失败');
    }
  };

  // --- Poll parsing status ---
  const pollStatus = (tid: string) => {
    const timer = setInterval(async () => {
      try {
        const statusData = await novelApiService.getBookImportTaskStatus(tid);
        const st = statusData.status;
        setTaskStatus(st);
        setParseProgress(statusData.progress ?? parseProgress);
        updateCache({ taskStatus: st, pageStep: 'parsing' });

        if (st === 'completed' || st === 'failed' || st === 'cancelled') {
          clearInterval(timer);
          setPollTimer(null);
          if (st === 'completed') {
            loadPreview(tid);
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 3000);
    setPollTimer(timer);
  };

  // --- Load preview ---
  const loadPreview = async (tid: string) => {
    try {
      const pv = await novelApiService.getBookImportPreview(tid);
      setPreview(pv);
      setChapters(pv.chapters || []);
      setProjectTitle(pv.projectSuggestion?.title || '');
      setProjectType(pv.projectSuggestion?.genre || '');
      setProjectTheme(pv.projectSuggestion?.theme || '');
      setProjectSummary(pv.projectSuggestion?.description || '');
      setNarrativeAngle(pv.projectSuggestion?.narrativePerspective || '');
      setTargetWordCount(pv.projectSuggestion?.targetWords || 50000);
      setPageStep('preview');
      updateCache({ preview: pv, pageStep: 'preview' });
    } catch { toast.error('加载预览失败'); }
  };

  // --- Apply import ---
  const applyImport = async () => {
    if (!taskId) return;
    setApplyProgress(0); setApplyStatus('applying'); setApplyError(null);
    setFailedSteps([]); setRetrying(false);
    setPageStep('applying');
    updateCache({ applyProgress: 0, applyStatus: 'applying', applyError: null, failedSteps: [], retrying: false, pageStep: 'applying' });

    try {
      const payload = {
        project_suggestion: {
          title: projectTitle,
          genre: projectType,
          theme: projectTheme,
          description: projectSummary,
          narrative_perspective: narrativeAngle,
          target_words: targetWordCount,
        },
        chapters: chapters.map((c) => ({
          chapter_number: c.chapterNumber,
          title: c.title,
          summary: c.summary || '',
          content: c.content || '',
        })),
        outlines: Array.isArray(preview?.outlines)
          ? preview.outlines
            .filter((outline) => outline && typeof outline === 'object')
            .map((outline, index) => {
              const record = outline as Record<string, unknown>;
              const title = typeof record.title === 'string' ? record.title : `第${index + 1}章`;
              const content = typeof record.content === 'string' ? record.content : '';
              const structure = record.structure ?? null;
              return {
                title,
                content,
                order_index: Number(record.order_index ?? index + 1),
                structure,
              };
            })
          : [],
      };

      const response = await novelApiService.applyBookImportStream(taskId, payload, modelRoutingPayload);
      await readSSEStream(response, false);
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : '导入失败';
      setApplyError(errorMessage);
      setApplyStatus('error');
      updateCache({ applyError: errorMessage, applyStatus: 'error' });
    }
  };

  // --- SSE stream reader ---
  const readSSEStream = async (response: Response, isRetry: boolean) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let shouldSyncRetryCache = true;
    let reachedTerminalEvent = false;
    let lastProgressUpdate = 0;
    const PROGRESS_THROTTLE_MS = 200;

    const handleSSELine = (line: string) => {
      if (!line.startsWith('data:')) {
        return;
      }

      try {
        const data = JSON.parse(line.slice(5).trim());

        if (data.type === 'progress') {
          const now = Date.now();
          if (now - lastProgressUpdate >= PROGRESS_THROTTLE_MS) {
            lastProgressUpdate = now;
            setApplyProgress(data.progress ?? applyProgress);
            setApplyStatus(data.status || 'processing');
            updateCache({ applyProgress: data.progress ?? applyProgress, applyStatus: data.status || 'processing' });
          }
          return;
        }

        if (data.type === 'result') {
          reachedTerminalEvent = true;
          setApplyProgress(100);
          setApplyStatus('completed');
          toast.success('🎉 拆书导入完成！');
          clearCache();
          shouldSyncRetryCache = false;
          setTimeout(() => router.push('/workspace/novel'), 1500);
          return;
        }

        if (data.type === 'error') {
          reachedTerminalEvent = true;
          const errorMessage = data.message || data.error || '导入出错';
          setApplyError(errorMessage);
          setApplyStatus('error');
          updateCache({ applyError: errorMessage, applyStatus: 'error' });
          return;
        }

        if (data.type === 'done') {
          reachedTerminalEvent = true;
          setApplyProgress(100);
          setApplyStatus('completed');
          clearCache();
          shouldSyncRetryCache = false;
          return;
        }

        if (data.type === 'step_failure' || data.status === 'step_failures') {
          let failuresRaw: unknown[] = [];
          if (Array.isArray(data.failed_steps)) {
            failuresRaw = data.failed_steps;
          } else if (typeof data.message === 'string') {
            try {
              const parsed = JSON.parse(data.message);
              if (parsed && Array.isArray(parsed.failed_steps)) {
                failuresRaw = parsed.failed_steps;
              }
            } catch {
              // ignore parse error
            }
          } else if (data.step_name || data.stepName) {
            failuresRaw = [data];
          }

          const normalizedFailures = failuresRaw
            .map((item) => {
              const entry = (item ?? {}) as Record<string, unknown>;
              const stepName = typeof entry.step_name === 'string'
                ? entry.step_name
                : typeof entry.stepName === 'string'
                  ? entry.stepName
                  : '';
              const stepLabel = typeof entry.step_label === 'string'
                ? entry.step_label
                : typeof entry.stepLabel === 'string'
                  ? entry.stepLabel
                  : '未知步骤';
              const error = typeof entry.error === 'string'
                ? entry.error
                : typeof entry.error_message === 'string'
                  ? entry.error_message
                  : '未知错误';
              return {
                stepName,
                stepLabel,
                error,
                retryCount: Number(entry.retry_count ?? entry.retryCount ?? 0),
              };
            })
            .filter((item) => item.stepName);

          if (normalizedFailures.length > 0) {
            setFailedSteps((prev) => {
              const next = [...prev, ...normalizedFailures];
              updateCache({ failedSteps: next });
              return next;
            });
          }
        }
      } catch {
        // skip malformed JSON
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          handleSSELine(line);
          if (reachedTerminalEvent) {
            return;
          }
        }
      }

      const tailLine = buffer.trim();
      if (tailLine) {
        handleSSELine(tailLine);
      }

      if (!reachedTerminalEvent) {
        throw new Error('导入流提前结束，未收到完成事件');
      }
    } finally {
      if (isRetry) {
        setRetrying(false);
        if (shouldSyncRetryCache) {
          updateCache({ retrying: false });
        }
      }
    }
  };

  // --- Retry failed steps ---
  const retryFailedSteps = async () => {
    if (!taskId || failedSteps.length === 0) return;
    setRetrying(true);
    updateCache({ retrying: true });

    try {
      const stepNames = failedSteps.map((s) => s.stepName);
      const response = await novelApiService.retryBookImportStepsStream(taskId, stepNames, modelRoutingPayload);
      setFailedSteps([]);
      setApplyError(null);
      await readSSEStream(response, true);
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : '重试失败';
      setApplyError(errorMessage);
      setApplyStatus('error');
      setRetrying(false);
      updateCache({ applyError: errorMessage, applyStatus: 'error', retrying: false });
    }
  };

  // --- Cancel task ---
  const cancelTask = async () => {
    if (!taskId) return;
    try {
      await novelApiService.cancelBookImportTask(taskId);
      setTaskStatus('cancelled');
      toast.info('任务已取消');
      resetAll();
    } catch { toast.error('取消失败'); }
  };

  // --- Chapter editing ---
  const updateChapter = (index: number, field: keyof BookImportChapter, value: string) => {
    setChapters((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  };

  const stepLabels: Record<PageStep, string> = {
    upload: '上传文件',
    parsing: '解析中',
    preview: '预览修正',
    applying: '生成导入',
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted to-secondary p-4 pb-20 md:p-8 pb-20">
      <div className="mx-auto max-w-screen-xl">
        {/* Top card */}
        <Card className="mb-6 overflow-hidden">
          <div className="bg-gradient-to-r from-primary/90 to-primary/70 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl text-white flex items-center gap-2">
                  📥 拆书导入
                </CardTitle>
                <CardDescription className="text-white/80 mt-1">
                  上传 TXT 文件，智能拆分为章节结构并导入为小说项目
                </CardDescription>
              </div>
              <Badge variant="secondary" className="shrink-0">
                步骤 {Object.keys(stepLabels).indexOf(pageStep) + 1}/4 · {stepLabels[pageStep]}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {(Object.entries(stepLabels) as [PageStep, string][]).map(([key, label], i) => (
            <div key={key} className="flex items-center gap-2">
              <span className={cn(pageStep === key ? 'font-semibold text-primary' : '')}>{label}</span>
              {i < Object.keys(stepLabels).length - 1 && <ChevronRight className="h-3 w-3" />}
            </div>
          ))}
        </div>

        {/* ====== STEP 0: Upload ====== */}
        {pageStep === 'upload' && (
          <Card className="mx-auto max-w-2xl">
            <CardHeader><CardTitle>上传 TXT 文件</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                className={cn(
                  'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors cursor-pointer',
                  dragOver ? 'border-primary bg-primary/5' : file ? 'border-green-400 bg-green-50' : 'border-muted-foreground/25',
                )}
              >
                {file ? (
                  <>
                    <CheckCircle className="h-10 w-10 text-green-500 mb-2" />
                    <p className="font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                      <X className="h-3 w-3 mr-1" />移除
                    </Button>
                  </>
                ) : (
                  <>
                    <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium">点击或拖拽文件到此处上传</p>
                    <p className="text-xs text-muted-foreground mt-1">仅支持 .txt 格式，建议 ≤50MB</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }} />

              {/* Parse range settings */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Settings className="h-4 w-4" />解析范围设置</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>解析方式</Label>
                    <Select value={parseRange} onValueChange={(v) => setParseRange(v as typeof parseRange)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tail">截取末 N 章反向生成</SelectItem>
                        <SelectItem value="full">整本反向生成</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {parseRange === 'tail' && (
                    <div>
                      <Label>末尾章节数</Label>
                      <Input type="number" min={5} max={55} step={5} value={tailChapters} onChange={(e) => setTailChapters(parseInt(e.target.value) || 20)} className="mt-1 w-32" />
                      <p className="text-xs text-muted-foreground mt-1">建议 20~55 章，反向生成可保留前文风格一致性</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Format info */}
              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  <strong>TXT格式要求：</strong>每章以类似“第X章”开头，章节间用空行分隔。系统会自动识别章节标题。
                </AlertDescription>
              </Alert>

              <Button className="w-full" size="lg" onClick={startParsing} disabled={!file}>
                <Play className="h-4 w-4 mr-2" />开始解析
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 1: Parsing ====== */}
        {pageStep === 'parsing' && (
          <Card className="mx-auto max-w-2xl">
            <CardContent className="py-12 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">正在解析文件...</p>
              <Progress value={parseProgress} className="max-w-md mx-auto" />
              <p className="text-sm text-muted-foreground">
                {{ pending: '等待调度...', processing: '正在解析文本...', completed: '解析完成！', failed: '解析失败', cancelled: '已取消' }[taskStatus] || taskStatus}
              </p>
              {taskId && (
                <p className="text-xs text-muted-foreground">任务ID: {taskId}</p>
              )}
              <div className="flex justify-center gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={() => taskId && loadPreview(taskId)}>
                  <RefreshCw className="h-3 w-3 mr-1" />刷新状态
                </Button>
                {taskStatus !== 'completed' && taskStatus !== 'failed' && taskStatus !== 'cancelled' && (
                  <Button variant="destructive" size="sm" onClick={() => setCancelConfirmOpen(true)}>取消任务</Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 2: Preview ====== */}
        {pageStep === 'preview' && preview && (
          <div className="space-y-6">
            {/* Warnings */}
            {preview.warnings && preview.warnings.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>发现{preview.warnings.length}个问题：</strong>
                  <ul className="list-disc list-inside mt-1 text-sm">
                    {preview.warnings.map((w, i) => (<li key={i}>{w.message}</li>))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Project info */}
            <Card>
              <CardHeader><CardTitle className="text-base">项目信息</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>标题</Label><Input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="mt-1" /></div>
                <div><Label>类型</Label><Input value={projectType} onChange={(e) => setProjectType(e.target.value)} className="mt-1" placeholder="如：玄幻、都市" /></div>
                <div className="md:col-span-2"><Label>主题</Label><Textarea rows={2} value={projectTheme} onChange={(e) => setProjectTheme(e.target.value)} className="mt-1" /></div>
                <div className="md:col-span-2"><Label>简介</Label><Textarea rows={3} value={projectSummary} onChange={(e) => setProjectSummary(e.target.value)} className="mt-1" /></div>
                <div><Label>叙事角度</Label><Select value={narrativeAngle} onValueChange={setNarrativeAngle}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="first_person">第一人称</SelectItem><SelectItem value="third_person_limited">第三人称有限视角</SelectItem><SelectItem value="third_person_omniscient">第三人称全知视角</SelectItem></SelectContent></Select></div>
                <div><Label>目标字数</Label><Input type="number" min={10000} step={10000} value={targetWordCount} onChange={(e) => setTargetWordCount(parseInt(e.target.value) || 50000)} className="mt-1" /></div>
              </CardContent>
            </Card>

            {/* Chapters list */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  章节列表 ({chapters.length}章)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div ref={chapterListRef} className="max-h-[500px] overflow-y-auto">
                  <div
                    style={{
                      height: `${chapterVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {chapterVirtualizer.getVirtualItems().map((virtualItem) => {
                      const idx = virtualItem.index;
                      const chapter = chapters[idx];
                      if (!chapter) return null;
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                        >
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <div className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent cursor-pointer">
                                <span className="text-sm font-medium truncate">
                                  第{chapter.chapterNumber}章: {chapter.title}
                                </span>
                                <Badge variant="outline" className="text-xs shrink-0 ml-2">
                                  {chapter.content ? `${(chapter.content.length / 2).toFixed(0)}字` : '?字'}
                                </Badge>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="space-y-3 pl-4 pt-2">
                              <div>
                                <Label className="text-xs">章节标题</Label>
                                <Input
                                  value={chapter.title || ''}
                                  onChange={(e) => updateChapter(idx, 'title', e.target.value)}
                                  className="mt-1 h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">摘要</Label>
                                <Textarea
                                  rows={2}
                                  value={chapter.summary || ''}
                                  onChange={(e) => updateChapter(idx, 'summary', e.target.value)}
                                  className="mt-1 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">正文（可编辑）</Label>
                                <Textarea
                                  rows={6}
                                  value={chapter.content || ''}
                                  onChange={(e) => updateChapter(idx, 'content', e.target.value)}
                                  className="mt-1 text-sm font-mono"
                                />
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <Button size="lg" onClick={applyImport} className="min-w-[200px]">
                <Play className="h-4 w-4 mr-2" />确认导入
              </Button>
            </div>
          </div>
        )}

        {/* ====== STEP 3: Applying ====== */}
        {pageStep === 'applying' && (
          <Card className="mx-auto max-w-2xl">
            <CardContent className="py-12 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">正在导入...</p>
              <Progress value={applyProgress} className="max-w-md mx-auto" />
              <p className="text-sm text-muted-foreground">{{ processing: '正在处理中...', completed: '导入完成！', error: '导入出错' }[applyStatus] || applyStatus}</p>

              {applyError && (
                <Alert variant="destructive" className="max-w-md mx-auto">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{applyError}</AlertDescription>
                </Alert>
              )}

              {/* Failed steps retry */}
              {failedSteps.length > 0 && !retrying && (
                <div className="max-w-md mx-auto space-y-3">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      有 {failedSteps.length} 个步骤失败，可以选择重试或跳过。
                      <ul className="list-disc list-inside mt-1 text-sm">
                        {failedSteps.map((fs, i) => (<li key={i}>{fs.stepLabel}: {fs.error}</li>))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                  <div className="flex justify-center gap-3">
                    <Button onClick={retryFailedSteps}><Redo className="h-4 w-4 mr-1" />智能重试全部</Button>
                    <Button variant="outline" onClick={() => { setFailedSteps([]); setApplyError(null); }}>跳过</Button>
                  </div>
                </div>
              )}

              {retrying && (
                <p className="text-sm text-muted-foreground">正在重试失败的步骤...</p>
              )}

              <div className="pt-4 text-xs text-muted-foreground max-w-md mx-auto">
                导入过程中，AI会自动补全缺失的章节摘要、角色列表等信息。完成后将自动跳转到工作区。
              </div>
            </CardContent>
          </Card>
        )}

        {/* Restart button (always visible when not uploading) */}
        {pageStep !== 'upload' && (
          <div className="fixed bottom-6 right-6 z-40">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1" />重新开始
            </Button>
          </div>
        )}
      </div>

      {/* Confirm restart dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>重新开始？</DialogTitle><DialogDescription>当前进度将被清除。</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => { resetAll(); setDeleteConfirmOpen(false); }}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm cancel dialog */}
      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>取消任务？</DialogTitle><DialogDescription>正在进行的解析将被终止。</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => { cancelTask(); setCancelConfirmOpen(false); }}>确认取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
