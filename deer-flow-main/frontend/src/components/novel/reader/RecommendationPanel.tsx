'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lightbulb, Loader2, MessageSquare, SkipForward, TrendingUp, Users, Clock } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { databaseService } from '@/core/novel/database';
import { executeRemoteFirst, novelApiService } from '@/core/novel/novel-api';
import { emitNovelEvent } from '@/core/novel/observability';
import type { RecommendationItem } from '@/core/novel/schemas';

const typeIcons: Record<string, React.ReactNode> = {
  plot_progression: <TrendingUp className="h-4 w-4" />,
  character_consistency: <Users className="h-4 w-4" />,
  narrative_pacing: <Clock className="h-4 w-4" />,
  foreshadowing: <Lightbulb className="h-4 w-4" />,
  world_building: <MessageSquare className="h-4 w-4" />,
  dialogue_improvement: <MessageSquare className="h-4 w-4" />,
};

const typeLabels: Record<string, string> = {
  plot_progression: '剧情推进',
  character_consistency: '角色一致性',
  narrative_pacing: '叙事节奏',
  foreshadowing: '伏笔管理',
  world_building: '世界观构建',
  dialogue_improvement: '对话优化',
};

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
};

interface RecommendationPanelProps {
  novelId: string;
}

function normalizeRecommendation(
  novelId: string,
  raw: Partial<RecommendationItem> & Record<string, unknown>,
): RecommendationItem {
  const now = new Date().toISOString();
  const safeType = (
    raw.type && typeof raw.type === 'string'
      ? raw.type
      : 'plot_progression'
  ) as RecommendationItem['type'];

  const safeTargetType = (
    raw.targetType && typeof raw.targetType === 'string'
      ? raw.targetType
      : 'global'
  ) as RecommendationItem['targetType'];

  const safePriority = (
    raw.priority && typeof raw.priority === 'string'
      ? raw.priority
      : 'medium'
  ) as RecommendationItem['priority'];

  const safeStatus = (
    raw.status && typeof raw.status === 'string'
      ? raw.status
      : 'pending'
  ) as RecommendationItem['status'];

  return {
    id: typeof raw.id === 'string' ? raw.id : `rec-${crypto.randomUUID().slice(0, 12)}`,
    novelId,
    type: safeType,
    title: typeof raw.title === 'string' ? raw.title : '创作建议',
    content: typeof raw.content === 'string' ? raw.content : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    targetType: safeTargetType,
    targetId: typeof raw.targetId === 'string' ? raw.targetId : undefined,
    priority: safePriority,
    status: safeStatus,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : undefined,
  };
}

async function fetchRecommendations(novelId: string): Promise<RecommendationItem[]> {
  return executeRemoteFirst(
    async () => {
      const remote = await novelApiService.getRecommendations(novelId);
      if (!Array.isArray(remote)) {
        console.warn("[recommendation] API returned non-array for novelId=%s: type=%s", novelId, typeof remote);
        const remoteRecord = remote as Record<string, unknown> | null;
        if (remoteRecord && typeof remoteRecord === "object" && Array.isArray(remoteRecord.items)) {
          return remoteRecord.items.map((item: unknown) => normalizeRecommendation(novelId, item as Record<string, unknown>));
        }
        return [];
      }
      const items = remote.map((item) => normalizeRecommendation(novelId, item as Record<string, unknown>));
      console.debug("[recommendation] fetched %d items for novelId=%s", items.length, novelId);
      return items;
    },
    () => databaseService.getRecommendationItems(novelId),
    'RecommendationPanel.fetchRecommendations',
    async (items) => {
      await Promise.all(items.map((item) => databaseService.updateRecommendationItem(item)));
    },
  );
}

async function generateRecommendations(novelId: string): Promise<RecommendationItem[]> {
  return executeRemoteFirst(
    async () => {
      const remote = await novelApiService.generateRecommendations(novelId);
      if (!Array.isArray(remote)) {
        console.warn("[recommendation] generate API returned non-array for novelId=%s: type=%s", novelId, typeof remote);
        const remoteRecord = remote as Record<string, unknown> | null;
        if (remoteRecord && typeof remoteRecord === "object" && Array.isArray(remoteRecord.items)) {
          return remoteRecord.items.map((item: unknown) => normalizeRecommendation(novelId, item as Record<string, unknown>));
        }
        return [];
      }
      const items = remote.map((item) => normalizeRecommendation(novelId, item as Record<string, unknown>));
      console.debug("[recommendation] generated %d items for novelId=%s", items.length, novelId);
      return items;
    },
    () => databaseService.getRecommendationItems(novelId),
    'RecommendationPanel.generateRecommendations',
    async (items) => {
      await Promise.all(items.map((item) => databaseService.updateRecommendationItem(item)));
    },
  );
}

async function acceptRecommendation(novelId: string, recId: string): Promise<RecommendationItem> {
  return executeRemoteFirst(
    async () => {
      const remote = await novelApiService.acceptRecommendation(novelId, recId);
      return normalizeRecommendation(novelId, remote as Record<string, unknown>);
    },
    async () => {
      const existing = (await databaseService.getRecommendationItems(novelId)).find((item) => item.id === recId);
      if (!existing) {
        throw new Error('Recommendation not found in local cache');
      }
      const updated: RecommendationItem = {
        ...existing,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      };
      await databaseService.updateRecommendationItem(updated);
      return updated;
    },
    'RecommendationPanel.acceptRecommendation',
    async (item) => {
      await databaseService.updateRecommendationItem(item);
    },
  );
}

async function ignoreRecommendation(novelId: string, recId: string): Promise<void> {
  try {
    await novelApiService.ignoreRecommendation(novelId, recId);
    console.debug("[recommendation] ignored remotely: novelId=%s recId=%s", novelId, recId);
  } catch (remoteError) {
    console.warn("[recommendation] remote ignore failed, falling back to local: novelId=%s recId=%s", novelId, recId, remoteError);
  }
  const existing = (await databaseService.getRecommendationItems(novelId)).find((item) => item.id === recId);
  if (!existing) {
    return;
  }
  await databaseService.updateRecommendationItem({
    ...existing,
    status: 'ignored',
  });
}

export function RecommendationPanel({ novelId }: RecommendationPanelProps) {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<string>('all');

  const { data: recommendations, isLoading, error } = useQuery({
    queryKey: ['recommendations', novelId],
    queryFn: () => fetchRecommendations(novelId),
    enabled: Boolean(novelId),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateRecommendations(novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations', novelId] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: ({ recId }: { recId: string }) => acceptRecommendation(novelId, recId),
    onSuccess: (item) => {
      emitNovelEvent('recommendation_accept', {
        novelId,
        recommendationId: item.id,
        recommendationType: item.type,
      });
      queryClient.invalidateQueries({ queryKey: ['recommendations', novelId] });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: ({ recId }: { recId: string }) => ignoreRecommendation(novelId, recId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations', novelId] });
    },
  });

  const handleAccept = useCallback(
    (recId: string) => {
      acceptMutation.mutate({ recId });
    },
    [acceptMutation]
  );

  const filteredRecommendations = recommendations?.filter((r) =>
    activeFilter === 'all' || r.type === activeFilter
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          <p>推荐加载失败，请重试</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            <CardTitle>创作建议</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Lightbulb className="mr-1 h-3 w-3" />
            )}
            重新生成
          </Button>
        </div>
        <CardDescription>AI 分析你的创作内容后给出的针对性建议</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeFilter} onValueChange={setActiveFilter}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="all" className="flex-1">全部</TabsTrigger>
            <TabsTrigger value="plot_progression" className="flex-1">剧情</TabsTrigger>
            <TabsTrigger value="character_consistency" className="flex-1">角色</TabsTrigger>
            <TabsTrigger value="narrative_pacing" className="flex-1">节奏</TabsTrigger>
          </TabsList>
        </Tabs>

        {filteredRecommendations?.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>暂无建议，点击"重新生成"获取新的创作建议</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecommendations?.map((rec) => (
              <div
                key={rec.id}
                className="p-4 rounded-lg border hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-0.5 text-muted-foreground">
                      {typeIcons[rec.type]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium text-sm">{rec.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {typeLabels[rec.type]}
                        </Badge>
                        {rec.priority && (
                          <Badge className={`text-xs ${priorityColors[rec.priority]}`}>
                            {rec.priority === 'critical' ? '紧急' :
                             rec.priority === 'high' ? '重要' :
                             rec.priority === 'medium' ? '建议' : '可选'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{rec.content}</p>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Lightbulb className="h-3 w-3" />
                        {rec.reason}
                      </p>
                    </div>
                  </div>

                  {rec.status === 'pending' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() => handleAccept(rec.id)}
                        title="采纳"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => ignoreMutation.mutate({ recId: rec.id })}
                        title="忽略"
                      >
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  {rec.status === 'accepted' && (
                    <Badge className="bg-green-100 text-green-800 text-xs">已采纳</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
