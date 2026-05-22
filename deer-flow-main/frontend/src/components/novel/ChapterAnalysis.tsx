"use client";

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
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

interface AnalysisTask {
  task_id?: string;
  status: "pending" | "running" | "completed" | "failed" | "none";
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
  hooks?: Array<{
    type: string;
    position: string;
    strength: number;
    content: string;
  }>;
  foreshadows?: Array<{
    type: "planted" | "resolved";
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

const isMobileDevice = () =>
  typeof window !== "undefined" && window.innerWidth < 768;

export default function ChapterAnalysis({
  chapterId,
  visible,
  onClose,
}: ChapterAnalysisProps) {
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [analysis, setAnalysis] = useState<ChapterAnalysisResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  const [, setChapterInfo] = useState<{
    title: string;
    chapter_number: number;
    content: string;
  } | null>(null);

  useEffect(() => {
    if (visible && chapterId) {
      fetchAnalysisStatus();
    }

    const handleResize = () => setIsMobile(isMobileDevice());
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
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
          content: data.content || "",
        });
      }
    } catch (err) {
      console.error("加载章节信息失败:", err);
    }
  }, [chapterId]);

  const fetchAnalysisStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await loadChapterInfo();

      const backendBase = getBackendBaseURL();
      const response = await fetch(
        `${backendBase}/api/chapters/${chapterId}/analysis/status`,
      );

      if (response.status === 404) {
        setTask(null);
        setError("该章节还未进行分析");
        return;
      }
      if (!response.ok) throw new Error("获取分析状态失败");

      const taskData: AnalysisTask = await response.json();

      if (taskData.status === "none" || !taskData.has_task) {
        setTask(null);
        setError(null);
        return;
      }

      setTask(taskData);

      if (taskData.status === "completed") {
        await fetchAnalysisResult();
      } else if (
        taskData.status === "running" ||
        taskData.status === "pending"
      ) {
        startPolling();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [chapterId, loadChapterInfo]);

  const fetchAnalysisResult = useCallback(async () => {
    try {
      const backendBase = getBackendBaseURL();
      const response = await fetch(
        `${backendBase}/api/chapters/${chapterId}/analysis`,
      );
      if (!response.ok) throw new Error("获取分析结果失败");
      const data: ChapterAnalysisResponse = await response.json();
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取分析结果失败");
    }
  }, [chapterId]);

  const startPolling = useCallback(() => {
    const pollInterval = setInterval(async () => {
      try {
        const backendBase = getBackendBaseURL();
        const response = await fetch(
          `${backendBase}/api/chapters/${chapterId}/analysis/status`,
        );
        if (!response.ok) return;

        const taskData: AnalysisTask = await response.json();
        setTask(taskData);

        if (taskData.status === "completed") {
          clearInterval(pollInterval);
          await fetchAnalysisResult();
          await loadChapterInfo();
        } else if (taskData.status === "failed") {
          clearInterval(pollInterval);
          setError(taskData.error_message || "分析失败");
        }
      } catch (err) {
        console.error("轮询错误:", err);
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
      const response = await fetch(
        `${backendBase}/api/chapters/${chapterId}/analyze`,
        { method: "POST" },
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "触发分析失败");
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发分析失败");
    } finally {
      setLoading(false);
    }
  };

  const renderStatusIcon = () => {
    if (!task) return null;
    switch (task.status) {
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "running":
        return (
          <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
        );
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  const renderProgress = () => {
    if (!task || task.status === "completed") return null;
    const isFailed = task.status === "failed";

    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center py-10">
        <div className="mb-8 text-center">
          {renderStatusIcon()}
          <p
            className={cn(
              "mt-4 text-xl font-bold",
              isFailed ? "text-destructive" : "text-foreground",
            )}
          >
            {task.status === "pending" && "等待分析..."}
            {task.status === "running" && "AI正在分析中..."}
            {task.status === "failed" && "分析失败"}
          </p>
        </div>

        <div className="mb-4 w-full max-w-md">
          <div className="bg-muted mb-3 h-3 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isFailed
                  ? "bg-destructive"
                  : task.progress === 100
                    ? "bg-green-500"
                    : "bg-primary",
              )}
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <p
            className={cn(
              "text-center text-3xl font-bold",
              isFailed
                ? "text-destructive"
                : task.progress === 100
                  ? "text-green-500"
                  : "text-primary",
            )}
          >
            {task.progress}%
          </p>
        </div>

        <p className="text-muted-foreground mb-4 min-h-[24px] text-base">
          {task.status === "pending" && "分析任务已创建，正在队列中..."}
          {task.status === "running" && "正在提取关键信息和记忆片段..."}
        </p>

        {isFailed && task.error_message && (
          <Alert variant="destructive" className="mt-4 max-w-md">
            <AlertTitle>分析失败</AlertTitle>
            <AlertDescription>{task.error_message}</AlertDescription>
          </Alert>
        )}

        {!isFailed && (
          <p className="text-muted-foreground/70 mt-4 text-xs">
            分析过程需要一定时间，请耐心等待
          </p>
        )}
      </div>
    );
  };

  const renderAnalysisResult = () => {
    if (!analysis) return null;
    const { analysis: ad, memories, entity_changes } = analysis;

    const hasEntityChanges = Boolean(
      entity_changes &&
      ((entity_changes.careers?.changes?.length || 0) > 0 ||
        (entity_changes.character_states?.changes?.length || 0) > 0 ||
        (entity_changes.organization_states?.changes?.length || 0) > 0),
    );

    return (
      <Tabs defaultValue="overview" className="h-full">
        <TabsList className="grid h-auto w-full grid-cols-6 flex-wrap gap-1">
          <TabsTrigger value="overview" className="text-xs">
            <Trophy className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            概览
          </TabsTrigger>
          <TabsTrigger value="hooks" className="text-xs">
            <Zap className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            钩子 ({ad.hooks?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="foreshadows" className="text-xs">
            <Flame className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            伏笔 ({ad.foreshadows?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="emotion" className="text-xs">
            <Heart className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            情感曲线
          </TabsTrigger>
          <TabsTrigger value="characters" className="text-xs">
            <Users className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            角色 ({ad.character_states?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="memories" className="text-xs">
            <Flame className="mr-1 hidden h-3.5 w-3.5 sm:inline" />
            记忆 ({memories?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* 概览 Tab */}
        <TabsContent
          value="overview"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <div className="space-y-4 pr-2">
              {ad.suggestions && ad.suggestions.length > 0 && (
                <Alert>
                  <Lightbulb className="h-4 w-4" />
                  <AlertTitle>发现改进建议</AlertTitle>
                  <AlertDescription>
                    <p className="mb-3">
                      AI已分析出 {ad.suggestions.length}{" "}
                      条改进建议，您可以根据这些建议重新生成章节内容。
                    </p>
                    <Button
                      size="sm"
                      onClick={() =>
                        toast.info("重新生成功能将在后续版本中提供")
                      }
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      根据建议重新生成
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">整体评分</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={cn(
                      "grid gap-4",
                      isMobile ? "grid-cols-2" : "grid-cols-4",
                    )}
                  >
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-muted-foreground text-sm">整体质量</p>
                      <p className="text-2xl font-bold text-green-600">
                        {ad.overall_quality_score || 0}
                        <span className="text-muted-foreground text-sm font-normal">
                          {" "}
                          / 10
                        </span>
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-muted-foreground text-sm">节奏把控</p>
                      <p className="text-2xl font-bold">
                        {ad.pacing_score || 0}
                        <span className="text-muted-foreground text-sm font-normal">
                          {" "}
                          / 10
                        </span>
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-muted-foreground text-sm">吸引力</p>
                      <p className="text-2xl font-bold">
                        {ad.engagement_score || 0}
                        <span className="text-muted-foreground text-sm font-normal">
                          {" "}
                          / 10
                        </span>
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-muted-foreground text-sm">连贯性</p>
                      <p className="text-2xl font-bold">
                        {ad.coherence_score || 0}
                        <span className="text-muted-foreground text-sm font-normal">
                          {" "}
                          / 10
                        </span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {ad.analysis_report && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">分析摘要</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">
                      {ad.analysis_report}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {hasEntityChanges && entity_changes && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">实体联动更新</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div
                      className={cn(
                        "grid gap-4",
                        isMobile ? "grid-cols-1" : "grid-cols-3",
                      )}
                    >
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground text-sm">
                          职业更新
                        </p>
                        <p className="text-xl font-bold">
                          {entity_changes.careers?.updated_count || 0}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground text-sm">
                          角色状态/关系更新
                        </p>
                        <p className="text-xl font-bold">
                          {(entity_changes.character_states
                            ?.state_updated_count || 0) +
                            (entity_changes.character_states
                              ?.relationship_created_count || 0) +
                            (entity_changes.character_states
                              ?.relationship_updated_count || 0) +
                            (entity_changes.character_states
                              ?.org_updated_count || 0)}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground text-sm">
                          组织状态更新
                        </p>
                        <p className="text-xl font-bold">
                          {entity_changes.organization_states?.updated_count ||
                            0}
                        </p>
                      </div>
                    </div>

                    {entity_changes.careers?.changes?.length ? (
                      <div className="mb-3">
                        <p className="mb-2 font-semibold">职业变化：</p>
                        <div className="flex flex-wrap gap-2">
                          {entity_changes.careers.changes.map((change, i) => (
                            <Badge
                              key={`career-${i}`}
                              variant="secondary"
                              className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            >
                              {change}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {entity_changes.character_states?.changes?.length ? (
                      <div className="mb-3">
                        <p className="mb-2 font-semibold">角色/关系变化：</p>
                        <div className="space-y-1">
                          {entity_changes.character_states.changes.map(
                            (change, i) => (
                              <p
                                key={i}
                                className="bg-muted/50 rounded px-2 py-1 text-sm"
                              >
                                {change}
                              </p>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}

                    {entity_changes.organization_states?.changes?.length ? (
                      <div>
                        <p className="mb-2 font-semibold">组织状态变化：</p>
                        <div className="space-y-1">
                          {entity_changes.organization_states.changes.map(
                            (change, i) => (
                              <p
                                key={i}
                                className="bg-muted/50 rounded px-2 py-1 text-sm"
                              >
                                {change}
                              </p>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              {ad.suggestions && ad.suggestions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Lightbulb className="h-4 w-4" />
                      改进建议
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {ad.suggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className="hover:bg-muted/50 flex gap-2 rounded px-3 py-2 transition-colors"
                        >
                          <span className="text-muted-foreground shrink-0">
                            {index + 1}.
                          </span>
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
        <TabsContent
          value="hooks"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.hooks && ad.hooks.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {ad.hooks.map((hook, idx) => (
                      <div
                        key={idx}
                        className="hover:bg-muted/30 rounded-lg border px-4 py-3 transition-colors"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          >
                            {hook.type}
                          </Badge>
                          <Badge variant="outline">{hook.position}</Badge>
                          <Badge
                            variant="secondary"
                            className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          >
                            强度: {hook.strength}/10
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {hook.content}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-12 text-center">
                    暂无钩子
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 伏笔 Tab */}
        <TabsContent
          value="foreshadows"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.foreshadows && ad.foreshadows.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {ad.foreshadows.map((fs, idx) => (
                      <div
                        key={idx}
                        className="hover:bg-muted/30 rounded-lg border px-4 py-3 transition-colors"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              fs.type === "planted" ? "default" : "secondary"
                            }
                            className={
                              fs.type === "planted"
                                ? "bg-green-500 text-white"
                                : "bg-purple-500 text-white"
                            }
                          >
                            {fs.type === "planted" ? "已埋下" : "已回收"}
                          </Badge>
                          <Badge variant="outline">
                            强度: {fs.strength}/10
                          </Badge>
                          <Badge variant="outline">
                            隐藏度: {fs.subtlety}/10
                          </Badge>
                          {fs.reference_chapter && (
                            <Badge
                              variant="secondary"
                              className="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
                            >
                              呼应第{fs.reference_chapter}章
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {fs.content}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-12 text-center">
                    暂无伏笔
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 情感曲线 Tab */}
        <TabsContent
          value="emotion"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.emotional_tone ? (
                  <div className="space-y-4 pr-2">
                    <div
                      className={cn(
                        "grid gap-4",
                        isMobile ? "grid-cols-1" : "grid-cols-2",
                      )}
                    >
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-muted-foreground mb-1 text-sm">
                          主导情绪
                        </p>
                        <p className="text-xl font-bold">{ad.emotional_tone}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-muted-foreground mb-1 text-sm">
                          情感强度
                        </p>
                        <p className="text-xl font-bold">
                          {((ad.emotional_intensity || 0) * 10).toFixed(1)}
                          <span className="text-muted-foreground text-sm font-normal">
                            {" "}
                            / 10
                          </span>
                        </p>
                      </div>
                    </div>

                    <Card className="border-dashed">
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">剧情阶段</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 pt-0">
                        <p>
                          <strong>阶段：</strong>
                          {ad.plot_stage || "-"}
                        </p>
                        <p>
                          <strong>冲突等级：</strong>
                          {ad.conflict_level ?? "-"} / 10
                        </p>
                        {ad.conflict_types && ad.conflict_types.length > 0 && (
                          <div className="mt-2">
                            <strong>冲突类型：</strong>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ad.conflict_types.map((type, idx) => (
                                <Badge
                                  key={idx}
                                  variant="destructive"
                                  className="text-xs"
                                >
                                  {type}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="text-muted-foreground py-12 text-center">
                    暂无情感分析
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 角色 Tab */}
        <TabsContent
          value="characters"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {ad.character_states && ad.character_states.length > 0 ? (
                  <div className="space-y-4 pr-2">
                    {ad.character_states.map((char, idx) => (
                      <Card key={idx} className="border-dashed">
                        <CardHeader className="py-2">
                          <CardTitle className="text-base">
                            {char.character_name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 pt-0 text-sm">
                          <p>
                            <strong>状态变化：</strong>
                            {char.state_before} → {char.state_after}
                          </p>
                          <p>
                            <strong>心理变化：</strong>
                            {char.psychological_change}
                          </p>
                          <p>
                            <strong>关键事件：</strong>
                            {char.key_event}
                          </p>
                          {char.relationship_changes &&
                            Object.keys(char.relationship_changes).length >
                              0 && (
                              <div className="mt-2">
                                <strong>关系变化：</strong>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {Object.entries(
                                    char.relationship_changes,
                                  ).map(([name, change]) => (
                                    <Badge
                                      key={name}
                                      variant="secondary"
                                      className="bg-blue-100 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                    >
                                      与{name}: {change}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-12 text-center">
                    暂无角色分析
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* 记忆 Tab */}
        <TabsContent
          value="memories"
          className={cn(
            "mt-4 overflow-y-auto pr-1",
            isMobile ? "max-h-[80vh]" : "max-h-[calc(90vh-220px)]",
          )}
        >
          <ScrollArea className="h-full">
            <Card>
              <CardContent className="pt-4">
                {memories && memories.length > 0 ? (
                  <div className="space-y-3 pr-2">
                    {memories.map((memory, idx) => (
                      <div
                        key={idx}
                        className="hover:bg-muted/30 rounded-lg border px-4 py-3 transition-colors"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          >
                            {memory.type}
                          </Badge>
                          <Badge variant="outline">
                            重要性: {memory.importance.toFixed(1)}
                          </Badge>
                          {memory.is_foreshadow === 1 && (
                            <Badge
                              variant="default"
                              className="bg-green-500 text-white"
                            >
                              已埋下伏笔
                            </Badge>
                          )}
                          {memory.is_foreshadow === 2 && (
                            <Badge
                              variant="default"
                              className="bg-purple-500 text-white"
                            >
                              已回收伏笔
                            </Badge>
                          )}
                          <span className="ml-2 text-sm font-medium">
                            {memory.title}
                          </span>
                        </div>
                        <p className="text-muted-foreground mb-2 text-sm">
                          {memory.content}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {memory.tags.map((tag, tagIdx) => (
                            <Badge
                              key={tagIdx}
                              variant="outline"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground py-12 text-center">
                    暂无记忆片段
                  </div>
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
      <DialogContent
        className={cn(
          "flex max-h-[90vh] max-w-[1400px] flex-col",
          isMobile ? "mx-4 w-[calc(100vw-32px)]" : "w-[90%]",
        )}
      >
        <DialogHeader>
          <DialogTitle>章节分析</DialogTitle>
        </DialogHeader>

        <div className="-mx-6 flex-1 overflow-hidden px-6">
          {loading && !task && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="border-primary mb-4 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
              <p className="text-muted-foreground">加载中...</p>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {task && task.status !== "completed" && renderProgress()}
          {task &&
            task.status === "completed" &&
            analysis &&
            renderAnalysisResult()}
        </div>

        <div className="mt-2 flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {!task && !loading && (
            <Button onClick={triggerAnalysis} disabled={loading}>
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              开始分析
            </Button>
          )}
          {task && task.status === "failed" && (
            <Button
              variant="destructive"
              onClick={triggerAnalysis}
              disabled={loading}
            >
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              重新分析
            </Button>
          )}
          {task && task.status === "completed" && (
            <Button
              variant="outline"
              onClick={triggerAnalysis}
              disabled={loading}
            >
              {loading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              重新分析
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
