'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Info, Loader2, Shield, Users, FileText, Calendar } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { novelApiService } from '@/core/novel/novel-api';
import type { Chapter, Character, TimelineEvent } from '@/core/novel/schemas';

interface QualityIssue {
  type: string;
  severity: 'warning' | 'error' | 'info' | 'success';
  message: string;
  details?: Record<string, any>;
  relatedIds?: string[];
}

interface QualityReport {
  novelId: string;
  score: number;
  metrics: {
    wordCount: number;
    chapterCount: number;
    characterCount: number;
    timelineEventCount: number;
  };
  issues: QualityIssue[];
  generatedAt: string;
}

interface QualityReportPanelProps {
  novelId: string;
  chapters: Chapter[];
  characters: Character[];
  timelineEvents: TimelineEvent[];
}

interface GateCheckIssue {
  message?: string;
}

interface GateCheckResult {
  title?: string;
  result?: 'pass' | 'warn' | 'block' | string;
  issue_count?: number;
  issues?: GateCheckIssue[];
}

export interface FinalizeGateReport {
  result?: 'pass' | 'warn' | 'block' | string;
  checked_at?: string;
  can_finalize?: boolean;
  summary?: {
    block_checks?: number;
    warn_checks?: number;
    total_issues?: number;
  };
  checks?: GateCheckResult[];
}

export interface FinalizeGateFeedbackState {
  gateReport: FinalizeGateReport | null;
  gateMessage: string;
  finalizeMessage: string;
}

export type FinalizeGateFeedbackEvent =
  | { type: 'gate_success'; report: FinalizeGateReport | null }
  | { type: 'gate_error'; message: string }
  | { type: 'finalize_success' }
  | { type: 'finalize_blocked'; report: FinalizeGateReport }
  | { type: 'finalize_error'; message: string };

export function reduceFinalizeGateFeedbackState(
  previous: FinalizeGateFeedbackState,
  event: FinalizeGateFeedbackEvent,
): FinalizeGateFeedbackState {
  switch (event.type) {
    case 'gate_success':
      if (!event.report) {
        return {
          ...previous,
          gateReport: null,
          gateMessage: '门禁结果为空，请重试',
          finalizeMessage: '',
        };
      }
      return {
        ...previous,
        gateReport: event.report,
        gateMessage: event.report?.result === 'block' ? '门禁检查未通过，存在阻断项。' : '门禁检查已完成。',
        finalizeMessage: '',
      };
    case 'gate_error':
      return {
        ...previous,
        gateReport: null,
        gateMessage: event.message,
        finalizeMessage: '',
      };
    case 'finalize_success':
      return {
        ...previous,
        gateReport: null,
        gateMessage: '',
        finalizeMessage: '定稿执行成功。',
      };
    case 'finalize_blocked':
      return {
        ...previous,
        gateReport: event.report,
        gateMessage: '门禁检查未通过，存在阻断项。',
        finalizeMessage: '定稿被门禁阻断。',
      };
    case 'finalize_error':
      return {
        ...previous,
        gateReport: null,
        gateMessage: '',
        finalizeMessage: event.message,
      };
    default:
      return previous;
  }
}

export function applyFinalizeSuccessTransition(
  previous: FinalizeGateFeedbackState,
): FinalizeGateFeedbackState {
  return reduceFinalizeGateFeedbackState(previous, { type: 'finalize_success' });
}

async function fetchQualityReport(novelId: string): Promise<QualityReport> {
  const remote = await novelApiService.getQualityReport(novelId) as Partial<QualityReport>;
  return {
    novelId,
    score: typeof remote.score === 'number' ? remote.score : 0,
    metrics: {
      wordCount: remote.metrics?.wordCount ?? 0,
      chapterCount: remote.metrics?.chapterCount ?? 0,
      characterCount: remote.metrics?.characterCount ?? 0,
      timelineEventCount: remote.metrics?.timelineEventCount ?? 0,
    },
    issues: Array.isArray(remote.issues) ? remote.issues : [],
    generatedAt: typeof remote.generatedAt === 'string' ? remote.generatedAt : new Date().toISOString(),
  };
}

function parseGateReportFromError(error: unknown): FinalizeGateReport | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const apiError = error as { details?: unknown };
  const details = apiError.details;
  if (typeof details !== 'object' || details === null) {
    return null;
  }
  const record = details as Record<string, unknown>;
  const fromTopLevel = record.gate_report;
  if (typeof fromTopLevel === 'object' && fromTopLevel !== null) {
    return fromTopLevel as FinalizeGateReport;
  }
  const detail = record.detail;
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const nested = (detail as Record<string, unknown>).gate_report;
  if (typeof nested !== 'object' || nested === null) {
    return null;
  }
  return nested as FinalizeGateReport;
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '请求失败，请稍后重试';
}

function summarizeGateReport(report: FinalizeGateReport | null): string[] {
  if (!report) {
    return [];
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const blockMessages = checks
    .filter((check) => check.result === 'block')
    .flatMap((check) => {
      const issues = Array.isArray(check.issues) ? check.issues : [];
      const first = issues[0]?.message ?? '';
      if (!first) {
        return [];
      }
      return [`${check.title || '未命名检查'}：${first}`];
    });
  if (blockMessages.length > 0) {
    return blockMessages.slice(0, 3);
  }
  const summary = report.summary;
  return [
    `阻断检查 ${summary?.block_checks ?? 0} 项`,
    `告警检查 ${summary?.warn_checks ?? 0} 项`,
    `总问题 ${summary?.total_issues ?? 0} 项`,
  ];
}

const severityIcons: Record<string, React.ReactNode> = {
  error: <AlertCircle className="h-4 w-4 text-red-500" />,
  warning: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
  success: <CheckCircle className="h-4 w-4 text-green-500" />,
};

const severityColors: Record<string, string> = {
  error: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
};

const severityLabels: Record<string, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
  success: '通过',
};

export function QualityReportPanel({ novelId, chapters, characters, timelineEvents }: QualityReportPanelProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [feedbackState, setFeedbackState] = useState<FinalizeGateFeedbackState>({
    gateReport: null,
    gateMessage: '',
    finalizeMessage: '',
  });
  const { gateReport, gateMessage, finalizeMessage } = feedbackState;

  const setFeedbackStateByEvent = (event: FinalizeGateFeedbackEvent) => {
    setFeedbackState((previous) => reduceFinalizeGateFeedbackState(previous, event));
  };

  const { data: report, isLoading, refetch } = useQuery({
    queryKey: ['quality-report', novelId],
    queryFn: () => fetchQualityReport(novelId),
  });

  const gateMutation = useMutation({
    mutationFn: async () => novelApiService.checkFinalizeGate(novelId),
    onSuccess: (result) => {
      const normalized = (result ?? null) as FinalizeGateReport | null;
      setFeedbackStateByEvent({ type: 'gate_success', report: normalized });
    },
    onError: (error) => {
      setFeedbackStateByEvent({ type: 'gate_error', message: parseErrorMessage(error) });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => novelApiService.finalizeProject(novelId),
    onSuccess: () => {
      setFeedbackStateByEvent({ type: 'finalize_success' });
    },
    onError: (error) => {
      const blockedReport = parseGateReportFromError(error);
      if (blockedReport) {
        setFeedbackStateByEvent({ type: 'finalize_blocked', report: blockedReport });
        return;
      }
      setFeedbackStateByEvent({ type: 'finalize_error', message: parseErrorMessage(error) });
    },
  });

  const localReport = useMemo((): QualityReport => {
    const totalWords = chapters.reduce((acc, ch) => {
      const text = ch.content?.replace(/<[^>]*>/g, '') || '';
      return acc + text.length;
    }, 0);

    const issues: QualityIssue[] = [];

    if (totalWords < 1000) {
      issues.push({
        type: 'low_word_count',
        severity: 'warning',
        message: `当前总字数仅 ${totalWords} 字，建议继续丰富内容。`,
        details: { wordCount: totalWords },
      });
    }

    const charNames = characters.map((c) => c.name).filter(Boolean);
    const contentText = chapters.map((c) => c.content?.replace(/<[^>]*>/g, '') || '').join(' ');
    const unreferencedChars = charNames.filter((name) => !contentText.includes(name));
    if (unreferencedChars.length > 0) {
      issues.push({
        type: 'unreferenced_characters',
        severity: 'warning',
        message: `${unreferencedChars.length} 个角色未在正文中出现: ${unreferencedChars.slice(0, 5).join(', ')}${unreferencedChars.length > 5 ? '...' : ''}`,
        details: { unreferenced: unreferencedChars },
      });
    }

    const chaptersWithoutSummary = chapters.filter((c) => !c.summary).length;
    if (chaptersWithoutSummary > chapters.length * 0.5 && chapters.length > 3) {
      issues.push({
        type: 'missing_chapter_summaries',
        severity: 'info',
        message: `${chaptersWithoutSummary} 章缺少摘要，建议为章节添加摘要以便更好的结构管理。`,
      });
    }

    const orphanTimelineEvents = timelineEvents.filter((e) => !e.relatedChapterId).length;
    if (orphanTimelineEvents > timelineEvents.length * 0.3 && timelineEvents.length > 0) {
      issues.push({
        type: 'unlinked_timeline_events',
        severity: 'info',
        message: `${orphanTimelineEvents} 个时间线事件未关联到具体章节。`,
      });
    }

    if (characters.length === 0) {
      issues.push({
        type: 'no_characters',
        severity: 'error',
        message: '小说暂无角色设定，建议先建立角色档案。',
      });
    }

    const score = Math.min(100, Math.max(0, 60 + chapters.length * 5 + characters.length * 3 + (totalWords > 5000 ? 10 : 0) - issues.filter((i) => i.severity === 'error').length * 15 - issues.filter((i) => i.severity === 'warning').length * 5));

    return {
      novelId,
      score,
      metrics: {
        wordCount: totalWords,
        chapterCount: chapters.length,
        characterCount: characters.length,
        timelineEventCount: timelineEvents.length,
      },
      issues,
      generatedAt: new Date().toISOString(),
    };
  }, [chapters, characters, timelineEvents, novelId]);

  const displayReport = report || localReport;

  const issueCounts = useMemo(() => ({
    error: displayReport.issues.filter((i) => i.severity === 'error').length,
    warning: displayReport.issues.filter((i) => i.severity === 'warning').length,
    info: displayReport.issues.filter((i) => i.severity === 'info').length,
    success: displayReport.issues.filter((i) => i.severity === 'success').length,
  }), [displayReport]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <CardTitle>质量评估</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => gateMutation.mutate()}
              disabled={gateMutation.isPending || finalizeMutation.isPending}
            >
              <Loader2 className={`mr-1 h-3 w-3 ${gateMutation.isPending ? 'animate-spin' : ''}`} />
              门禁检查
            </Button>
            <Button
              size="sm"
              onClick={() => finalizeMutation.mutate()}
              disabled={gateMutation.isPending || finalizeMutation.isPending}
            >
              <Loader2 className={`mr-1 h-3 w-3 ${finalizeMutation.isPending ? 'animate-spin' : ''}`} />
              执行定稿
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <Loader2 className={`mr-1 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>
        <CardDescription>AI 自动检测内容质量和一致性问题</CardDescription>
      </CardHeader>
      <CardContent>
        {(gateMessage || finalizeMessage || gateReport) && (
          <Alert className="mb-4" variant={gateReport?.result === 'block' ? 'destructive' : 'default'}>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{gateReport?.result === 'block' ? '门禁阻断' : '定稿门禁状态'}</AlertTitle>
            <AlertDescription className="space-y-1">
              {gateMessage && <div>{gateMessage}</div>}
              {finalizeMessage && <div>{finalizeMessage}</div>}
              {summarizeGateReport(gateReport).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-center mb-6">
          <div className="relative w-32 h-32">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="#e5e7eb" strokeWidth="8" />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke={displayReport.score >= 80 ? '#22c55e' : displayReport.score >= 60 ? '#eab308' : '#ef4444'}
                strokeWidth="8"
                strokeDasharray={`${displayReport.score * 3.39} 339`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold ${getScoreColor(displayReport.score)}`}>
                {displayReport.score}
              </span>
              <span className="text-xs text-muted-foreground">质量分</span>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">概览</TabsTrigger>
            <TabsTrigger value="issues" className="flex-1">
              问题 {issueCounts.error + issueCounts.warning > 0 && (
                <Badge className="ml-1 bg-red-100 text-red-800 text-xs">
                  {issueCounts.error + issueCounts.warning}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="metrics" className="flex-1">指标</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">字数</span>
                </div>
                <p className="text-lg font-bold">{displayReport.metrics.wordCount.toLocaleString()}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">章节</span>
                </div>
                <p className="text-lg font-bold">{displayReport.metrics.chapterCount}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">角色</span>
                </div>
                <p className="text-lg font-bold">{displayReport.metrics.characterCount}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">时间线</span>
                </div>
                <p className="text-lg font-bold">{displayReport.metrics.timelineEventCount}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {issueCounts.error > 0 && (
                <Badge className={severityColors.error}>
                  {issueCounts.error} 错误
                </Badge>
              )}
              {issueCounts.warning > 0 && (
                <Badge className={severityColors.warning}>
                  {issueCounts.warning} 警告
                </Badge>
              )}
              {issueCounts.info > 0 && (
                <Badge className={severityColors.info}>
                  {issueCounts.info} 提示
                </Badge>
              )}
              {issueCounts.success > 0 && (
                <Badge className={severityColors.success}>
                  {issueCounts.success} 通过
                </Badge>
              )}
              {displayReport.issues.length === 0 && (
                <Badge className={severityColors.success}>全部通过</Badge>
              )}
            </div>
          </TabsContent>

          <TabsContent value="issues" className="space-y-3 mt-4">
            {displayReport.issues.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="mx-auto h-8 w-8 text-green-500 mb-2" />
                <p className="text-sm text-muted-foreground">没有发现问题，内容质量良好！</p>
              </div>
            ) : (
              displayReport.issues
                .sort((a, b) => {
                  const order = { error: 0, warning: 1, info: 2, success: 3 };
                  return (order[a.severity] || 0) - (order[b.severity] || 0);
                })
                .map((issue, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 border rounded-lg">
                    {severityIcons[issue.severity]}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`text-xs ${severityColors[issue.severity]}`}>
                          {severityLabels[issue.severity]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{issue.type}</span>
                      </div>
                      <p className="text-sm">{issue.message}</p>
                    </div>
                  </div>
                ))
            )}
          </TabsContent>

          <TabsContent value="metrics" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">字数进度</span>
                  <span className="text-xs text-muted-foreground">{displayReport.metrics.wordCount.toLocaleString()} / 5000</span>
                </div>
                <Progress value={Math.min(100, (displayReport.metrics.wordCount / 5000) * 100)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">章节密度</span>
                  <span className="text-xs text-muted-foreground">{displayReport.metrics.chapterCount} 章</span>
                </div>
                <Progress value={Math.min(100, displayReport.metrics.chapterCount * 10)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">角色丰富度</span>
                  <span className="text-xs text-muted-foreground">{displayReport.metrics.characterCount} 角色</span>
                </div>
                <Progress value={Math.min(100, displayReport.metrics.characterCount * 20)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">时间线完整度</span>
                  <span className="text-xs text-muted-foreground">{displayReport.metrics.timelineEventCount} 事件</span>
                </div>
                <Progress value={Math.min(100, displayReport.metrics.timelineEventCount * 15)} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
