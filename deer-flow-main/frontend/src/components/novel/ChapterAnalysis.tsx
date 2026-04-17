'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Zap,
  Lightbulb,
  Flame,
  Heart,
  Users,
  Trophy,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCcw,
  Pencil,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { getBackendBaseURL } from '@/core/config';

interface AnalysisTask {
  task_id?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'none';
  progress: number;
  error_message?: string;
  has_task?: boolean;
}

interface AnalysisData {
  overall_quality_score: number;
  pacing_score: number;
  engagement_score: number;
  coherence_score: number;
  analysis_report?: string;
  suggestions?: string[];
  hooks?: Array<{ type: string; position: string; strength: number; content: string }>;
  foreshadows?: Array<{
    type: 'planted' | 'resolved';
    strength: number;
    subtlety: number;
    content: string;
    reference_chapter?: number;
  }>;
  emotional_tone?: string;
  emotional_intensity?: number;
  plot_stage?: string;
  conflict_level?: number;
  conflict_types?: string[];
  character_states?: Array<{
    character_name: string;
    state_before: string;
    state_after: string;
    psychological_change: string;
    key_event: string;
    relationship_changes?: Record<string, string>;
  }>;
}

interface MemoryItem {
  type: string;
  title: string;
  content: string;
  importance: number;
  tags: string[];
  is_foreshadow: number;
}

interface EntityChanges {
  careers?: { changes: string[]; updated_count: number };
  character_states?: {
    changes: string[];
    state_updated_count: number;
    relationship_created_count: number;
    relationship_updated_count: number;
    org_updated_count: number;
  };
  organization_states?: { changes: string[]; updated_count: number };
}

interface ChapterAnalysisResponse {
  analysis: AnalysisData;
  memories?: MemoryItem[];
  entity_changes?: EntityChanges;
}

interface ChapterAnalysisProps {
  chapterId: string;
  visible: boolean;
  onClose: () => void;
}

const isMobileDevice = () => typeof window !== 'undefined' && window.innerWidth < 768;

export default function ChapterAnalysis({ chapterId, visible, onClose }: ChapterAnalysisProps) {
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [analysis, setAnalysis] = useState<ChapterAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  const [chapterInfo, setChapterInfo] = useState<{ title: string; chapter_number: number; content: string } | null>(null);

  useEffect(() => {
    if (visible && chapterId) {
      fetchAnalysisStatus();
    }

    const handleResize = () => setIsMobile(isMobileDevice());
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, chapterId]);

  const loadChapterInfo = useCallback(async () => {
    try {
      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/chapters/${chapterId}`);
      if (response.ok) {
        const data = await response.json();
        setChapterInfo({
          title: data.title,
          chapter_number: data.chapter_number,
          content: data.content || '',
        });
      }
    } catch (err) {
      console.error('加载章节信息失败:', err);
    }
  }, [chapterId]);

  const fetchAnalysisStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await loadChapterInfo();

      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/chapters/${chapterId}/analysis/status`);

      if (response.status === 404) {
        setTask(null);
        setError('该章节还未进行分析');
        return;
      }
      if (!response.ok) throw new Error('获取分析状态失败');

      const taskData: AnalysisTask = await response.json();

      if (taskData.status === 'none' || !taskData.has_task) {
        setTask(null);
        setError(null);
        return;
      }

      setTask(taskData);

      if (taskData.status === 'completed') {
        await fetchAnalysisResult();
      } else if (taskData.status === 'running' || taskData.status === 'pending') {
        startPolling();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [chapterId, loadChapterInfo]);

  const fetchAnalysisResult = useCallback(async () => {
    try {
      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/chapters/${chapterId}/analysis`);
      if (!response.ok) throw new Error('获取分析结果失败');
      const data: ChapterAnalysisResponse = await response.json();
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取分析结果失败');
    }
  }, [chapterId]);

  const startPolling = useCallback(() => {
    const pollInterval = setInterval(async () => {
      try {
        const backendBase = getBackendBaseURL();
        const response = await fetch(`${backendBase}/api/chapters/${chapterId}/analysis/status`);
        if (!response.ok) return;

        const taskData: AnalysisTask = await response.json();
        setTask(taskData);

        if (taskData.status === 'completed') {
          clearInterval(pollInterval);
          await fetchAnalysisResult();
          await loadChapterInfo();
        } else if (taskData.status === 'failed') {
          clearInterval(pollInterval);
          setError(taskData.error_message || '分析失败');
        }
      } catch (err) {
        console.error('轮询错误:', err);
      }
    }, 2000);

    setTimeout(() => clearInterval(pollInterval), 300000);
  }, [chapterId, fetchAnalysisResult, loadChapterInfo]);

  const triggerAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);
      await loadChapterInfo();

      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/chapters/${chapterId}/analyze`, { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '触发分析失败');
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发分析失败');
    } finally {
      setLoading(false);
    }
  };

  const renderStatusIcon = () => {
    if (!task) return null;
    switch (task.status) {
      case 'pending': return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'running': return <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />;
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
      default: return null;
    }
  };

  const renderProgress = () => {
    if (!task || task.status === 'completed') return null;
    const isFailed = task.status === 'failed';

    return (
      <div className="flex flex-col items-center justify-center py-10 min-h-[300px]">
        <div className="text-center mb-8">
          {renderStatusIcon()}
          <p className={cn("mt-4 text-xl font-bold", isFailed ? "text-destructive" : "text-foreground")}>
            {task.status === 'pending' && '等待分析...'}
            {task.status === 'running' && 'AI正在分析中...'}
            {task.status === 'failed' && '分析失败'}
          </p>
        </div>

        <div className="w-full max-w-md mb-4">
          <div className="h-3 bg-muted rounded-full overflow-hidden mb-3">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isFailed
                  ? "bg-destructive"
                  : task.progress === 100
                    ? "bg-green-500"
                    : "bg-primary"
              )}
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <p className={cn(
            "text-center text-3xl font-bold",
            isFailed ? "text-destructive" : task.progress === 100 ? "text-green-500" : "text-primary"
          )}>
            {task.progress}%
          </p>
        </div>

        <p className="text-base text-muted-foreground mb-4 min-h-[24px]">
          {task.status === 'pending' && '分析任务已创建，正在队列中...'}
          {task.status === 'running' && '正在提取关键信息和记忆片段...'}
        </p>

        {isFailed && task.error_message && (
          <Alert variant="destructive" className="max-w-md mt-4">
            <AlertTitle>分析失败</AlertTitle>
            <AlertDescription>{task.error_message}</AlertDescription>
          </Alert>
        )}

        {!isFailed && (
          <p className="text-xs text-muted-foreground/70 mt-4">分析过程需要一定时间，请耐心等待</p>
        )}
      </div>
    );
  };

  const renderAnalysisResult = () => {
    if (!analysis) return null;
    const { analysis: ad, memories, entity_changes } = analysis;

    const hasEntityChanges = Boolean(
      entity_changes && (
        (entity_changes.careers?.changes?.length || 0) > 0 ||
        (entity_changes.character_states?.changes?.length || 0) > 0 ||
        (entity_changes.organization_states?.changes?.length || 0) > 0
      )
    );

    return (
      <Tabs defaultValue="overview" className="h-full">
        <TabsList className="grid w-full grid-cols-6 h-auto flex-wrap gap-1">
          <TabsTrigger value="overview" className="text-xs"><Trophy className="w-3.5 h-3.5 mr-1 hidden sm:inline" />概览</TabsTrigger>
          <TabsTrigger value="hooks" className="text-xs"><Zap className="w-3.5 h-3.5 mr-1 hidden sm:inline" />钩子 ({ad.hooks?.length || 0})</TabsTrigger>
          <TabsTrigger value="foreshadows" className="text-xs"><Flame className="w-3.5 h-3.5 mr-1 hidden sm:inline" />伏笔 ({ad.foreshadows?.length || 0})</TabsTrigger>
          <TabsTrigger value="emotion" className="text-xs"><Heart className="w-3.5 h-3.5 mr-1 hidden sm:inline" />情感曲线</TabsTrigger>
          <TabsTrigger value="characters" className="text-xs"><Users className="w-3.5 h-3.5 mr-1 hidden sm:inline" />角色 ({ad.character_states?.length || 0})</TabsTrigger>
          <TabsTrigger value="memories" className="text-xs"><Flame className="w-3.5 h-3.5 mr-1 hidden sm:inline" />记忆 ({memories?.length || 0})</TabsTrigger>
        </TabsList>

        {/* 概览 Tab */}
        <TabsContent value="overview" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <div className="space-y-4 pr-2">
              {ad.suggestions && ad.suggestions.length > 0 && (
                <Alert>
                  <Lightbulb className="h-4 w-4" />
                  <AlertTitle>发现改进建议</AlertTitle>
                  <AlertDescription>
                    <p className="mb-3">AI已分析出 {ad.suggestions.length} 条改进建议，您可以根据这些建议重新生成章节内容。</p>
                    <Button size="sm" onClick={() => toast.info('重新生成功能将在后续版本中提供')}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      根据建议重新生成
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">整体评分</CardTitle></CardHeader>
                <CardContent>
                  <div className={cn("grid gap-4", isMobile ? "grid-cols-2" : "grid-cols-4")}>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground">整体质量</p>
                      <p className="text-2xl font-bold text-green-600">{ad.overall_quality_score || 0}<span className="text-sm font-normal text-muted-foreground"> / 10</span></p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground">节奏把控</p>
                      <p className="text-2xl font-bold">{ad.pacing_score || 0}<span className="text-sm font-normal text-muted-foreground"> / 10</span></p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground">吸引力</p>
                      <p className="text-2xl font-bold">{ad.engagement_score || 0}<span className="text-sm font-normal text-muted-foreground"> / 10</span></p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground">连贯性</p>
                      <p className="text-2xl font-bold">{ad.coherence_score || 0}<span className="text-sm font-normal text-muted-foreground"> / 10</span></p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {ad.analysis_report && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">分析摘要</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{ad.analysis_report}</pre>
                  </CardContent>
                </Card>
              )}

              {hasEntityChanges && entity_changes && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">实体联动更新</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-3")}>
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">职业更新</p>
                        <p className="text-xl font-bold">{entity_changes.careers?.updated_count || 0}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">角色状态/关系更新</p>
                        <p className="text-xl font-bold">
                          {(entity_changes.character_states?.state_updated_count || 0) +
                          (entity_changes.character_states?.relationship_created_count || 0) +
                          (entity_changes.character_states?.relationship_updated_count || 0) +
                          (entity_changes.character_states?.org_updated_count || 0)}
                        </p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">组织状态更新</p>
                        <p className="text-xl font-bold">{entity_changes.organization_states?.updated_count || 0}</p>
                      </div>
                    </div>

                    {entity_changes.careers?.changes?.length ? (
                      <div className="mb-3">
                        <p className="font-semibold mb-2">职业变化：</p>
                        <div className="flex flex-wrap gap-2">
                          {entity_changes.careers.changes.map((change, i) => (
                            <Badge key={`career-${i}`} variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{change}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {entity_changes.character_states?.changes?.length ? (
                      <div className="mb-3">
                        <p className="font-semibold mb-2">角色/关系变化：</p>
                        <div className="space-y-1">
                          {entity_changes.character_states.changes.map((change, i) => (
                            <p key={i} className="text-sm py-1 px-2 rounded bg-muted/50">{change}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {entity_changes.organization_states?.changes?.length ? (
                      <div>
                        <p className="font-semibold mb-2">组织状态变化：</p>
                        <div className="space-y-1">
                          {entity_changes.organization_states.changes.map((change, i) => (
                            <p key={i} className="text-sm py-1 px-2 rounded bg-muted/50">{change}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              {ad.suggestions && ad.suggestions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Lightbulb className="w-4 h-4" />
                      改进建议
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {ad.suggestions.map((suggestion, index) => (
                        <div key={index} className="flex gap-2 py-2 px-3 rounded hover:bg-muted/50 transition-colors">
                          <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
                          <span className="text-sm">{suggestion}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* 钩子 Tab */}
        <TabsContent value="hooks" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.hooks && ad.hooks.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {ad.hooks.map((hook, idx) => (
                      <div key={idx} className="py-3 px-4 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{hook.type}</Badge>
                          <Badge variant="outline">{hook.position}</Badge>
                          <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">强度: {hook.strength}/10</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{hook.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">暂无钩子</div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 伏笔 Tab */}
        <TabsContent value="foreshadows" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.foreshadows && ad.foreshadows.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {ad.foreshadows.map((fs, idx) => (
                      <div key={idx} className="py-3 px-4 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant={fs.type === 'planted' ? 'default' : 'secondary'} className={fs.type === 'planted' ? 'bg-green-500 text-white' : 'bg-purple-500 text-white'}>
                            {fs.type === 'planted' ? '已埋下' : '已回收'}
                          </Badge>
                          <Badge variant="outline">强度: {fs.strength}/10</Badge>
                          <Badge variant="outline">隐藏度: {fs.subtlety}/10</Badge>
                          {fs.reference_chapter && (
                            <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">呼应第{fs.reference_chapter}章</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{fs.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">暂无伏笔</div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 情感曲线 Tab */}
        <TabsContent value="emotion" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.emotional_tone ? (
                  <div className="space-y-4 pr-2">
                    <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="text-center p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground mb-1">主导情绪</p>
                        <p className="text-xl font-bold">{ad.emotional_tone}</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground mb-1">情感强度</p>
                        <p className="text-xl font-bold">{((ad.emotional_intensity || 0) * 10).toFixed(1)}<span className="text-sm font-normal text-muted-foreground"> / 10</span></p>
                      </div>
                    </div>

                    <Card className="border-dashed">
                      <CardHeader className="py-2"><CardTitle className="text-sm">剧情阶段</CardTitle></CardHeader>
                      <CardContent className="pt-0 space-y-1">
                        <p><strong>阶段：</strong>{ad.plot_stage || '-'}</p>
                        <p><strong>冲突等级：</strong>{ad.conflict_level ?? '-'} / 10</p>
                        {ad.conflict_types && ad.conflict_types.length > 0 && (
                          <div className="mt-2">
                            <strong>冲突类型：</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {ad.conflict_types.map((type, idx) => (
                                <Badge key={idx} variant="destructive" className="text-xs">{type}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">暂无情感分析</div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 角色 Tab */}
        <TabsContent value="characters" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.character_states && ad.character_states.length > 0 ? (
                  <div className="space-y-4 pr-2">
                    {ad.character_states.map((char, idx) => (
                      <Card key={idx} className="border-dashed">
                        <CardHeader className="py-2"><CardTitle className="text-base">{char.character_name}</CardTitle></CardHeader>
                        <CardContent className="pt-0 space-y-1 text-sm">
                          <p><strong>状态变化：</strong>{char.state_before} → {char.state_after}</p>
                          <p><strong>心理变化：</strong>{char.psychological_change}</p>
                          <p><strong>关键事件：</strong>{char.key_event}</p>
                          {char.relationship_changes && Object.keys(char.relationship_changes).length > 0 && (
                            <div className="mt-2">
                              <strong>关系变化：</strong>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(char.relationship_changes).map(([name, change]) => (
                                  <Badge key={name} variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs">与{name}: {change}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">暂无角色分析</div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 记忆 Tab */}
        <TabsContent value="memories" className={cn("mt-4 overflow-y-auto pr-1", isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]")}>
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {memories && memories.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {memories.map((memory, idx) => (
                      <div key={idx} className="py-3 px-4 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{memory.type}</Badge>
                          <Badge variant="outline">重要性: {memory.importance.toFixed(1)}</Badge>
                          {memory.is_foreshadow === 1 && <Badge variant="default" className="bg-green-500 text-white">已埋下伏笔</Badge>}
                          {memory.is_foreshadow === 2 && <Badge variant="default" className="bg-purple-500 text-white">已回收伏笔</Badge>}
                          <span className="ml-2 font-medium text-sm">{memory.title}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{memory.content}</p>
                        <div className="flex flex-wrap gap-1">
                          {memory.tags.map((tag, tagIdx) => (
                            <Badge key={tagIdx} variant="outline" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">暂无记忆片段</div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn(
        "max-w-[1400px] max-h-[90vh] flex flex-col",
        isMobile ? "w-[calc(100vw-32px)] mx-4" : "w-[90%]"
      )}>
        <DialogHeader>
          <DialogTitle>章节分析</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden -mx-6 px-6">
          {loading && !task && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-muted-foreground">加载中...</p>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {task && task.status !== 'completed' && renderProgress()}
          {task && task.status === 'completed' && analysis && renderAnalysisResult()}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t mt-2">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {!task && !loading && (
            <Button onClick={triggerAnalysis} disabled={loading}>
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              开始分析
            </Button>
          )}
          {task && task.status === 'failed' && (
            <Button variant="destructive" onClick={triggerAnalysis} disabled={loading}>
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              重新分析
            </Button>
          )}
          {task && task.status === 'completed' && (
            <Button variant="outline" onClick={triggerAnalysis} disabled={loading}>
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              重新分析
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
