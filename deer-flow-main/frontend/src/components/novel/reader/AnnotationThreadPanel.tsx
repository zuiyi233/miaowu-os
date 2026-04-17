'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare,
  Plus,
  Send,
  CheckCircle2,
  X,
  Loader2,
  Bot,
  User,
  AtSign,
  Reply,
  Sparkles,
} from 'lucide-react';
import type { AnnotationThread } from '@/core/novel/schemas';
import { databaseService } from '@/core/novel/database';
import { novelAiService } from '@/core/novel/ai-service';
import { executeRemoteFirst, novelApiService } from '@/core/novel/novel-api';
import { emitNovelEvent } from '@/core/novel/observability';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  adopted: 'bg-purple-100 text-purple-800',
};

const statusLabels: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  resolved: '已解决',
  rejected: '已拒绝',
  adopted: '已采纳',
};

interface AnnotationThreadPanelProps {
  novelId: string;
  chapterId?: string;
  selectedText?: string | null;
  selectionRange?: { start: number; end: number } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeThread(novelId: string, raw: Partial<AnnotationThread> & Record<string, unknown>): AnnotationThread {
  const now = new Date().toISOString();
  const threadType = (
    raw.type && typeof raw.type === 'string' ? raw.type : 'annotation'
  ) as AnnotationThread['type'];
  const threadStatus = (
    raw.status && typeof raw.status === 'string' ? raw.status : 'pending'
  ) as AnnotationThread['status'];

  return {
    id: typeof raw.id === 'string' ? raw.id : `annotation-${crypto.randomUUID().slice(0, 12)}`,
    novelId,
    chapterId: typeof raw.chapterId === 'string' ? raw.chapterId : '',
    anchorText: typeof raw.anchorText === 'string' ? raw.anchorText : undefined,
    rangeStart: typeof raw.rangeStart === 'number' ? raw.rangeStart : undefined,
    rangeEnd: typeof raw.rangeEnd === 'number' ? raw.rangeEnd : undefined,
    title: typeof raw.title === 'string' ? raw.title : '未命名批注',
    content: typeof raw.content === 'string' ? raw.content : '',
    type: threadType,
    status: threadStatus,
    mentions: Array.isArray(raw.mentions)
      ? raw.mentions.filter((item): item is string => typeof item === 'string')
      : [],
    aiTask: isRecord(raw.aiTask)
      ? {
          prompt: typeof raw.aiTask.prompt === 'string' ? raw.aiTask.prompt : '',
          result: typeof raw.aiTask.result === 'string' ? raw.aiTask.result : undefined,
          status:
            raw.aiTask.status && typeof raw.aiTask.status === 'string'
              ? (raw.aiTask.status as 'pending' | 'running' | 'completed' | 'failed')
              : undefined,
        }
      : undefined,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

async function fetchThreads(novelId: string, chapterId?: string): Promise<AnnotationThread[]> {
  return executeRemoteFirst(
    async () => {
      const remote = await novelApiService.getInteractions(novelId);
      const normalized = Array.isArray(remote)
        ? remote.map((item) => normalizeThread(novelId, item as Record<string, unknown>))
        : [];
      return chapterId
        ? normalized.filter((thread) => thread.chapterId === chapterId)
        : normalized;
    },
    () => (chapterId
      ? databaseService.getAnnotationThreads(novelId, chapterId)
      : databaseService.getAnnotationThreads(novelId)),
    'AnnotationThreadPanel.fetchThreads',
    async (items) => {
      await Promise.all(items.map((thread) => databaseService.updateAnnotationThread(thread)));
    },
  );
}

export function AnnotationThreadPanel({ novelId, chapterId, selectedText, selectionRange }: AnnotationThreadPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'threads' | 'ai'>('threads');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadContent, setNewThreadContent] = useState('');
  const [newThreadType, setNewThreadType] = useState<'annotation' | 'ai_task' | 'discussion'>('annotation');
  const [replyContent, setReplyContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [aiTaskPrompt, setAiTaskPrompt] = useState('');
  const [aiTaskTarget, setAiTaskTarget] = useState<string>('');

  const { data: threads, isLoading } = useQuery({
    queryKey: ['annotation-threads', novelId, chapterId],
    queryFn: () => fetchThreads(novelId, chapterId),
  });

  const addThreadMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; type: string }) => {
      const now = new Date().toISOString();
      const thread: AnnotationThread = {
        id: `annotation-${crypto.randomUUID().slice(0, 12)}`,
        novelId,
        chapterId: chapterId || '',
        anchorText: selectedText || undefined,
        rangeStart: selectionRange?.start,
        rangeEnd: selectionRange?.end,
        title: data.title,
        content: data.content,
        type: data.type as 'annotation' | 'ai_task' | 'discussion',
        status: 'pending',
        mentions: [],
        createdAt: now,
        updatedAt: now,
      };
      await executeRemoteFirst(
        async () => {
          const remote = await novelApiService.createInteraction(novelId, thread);
          const normalized = normalizeThread(novelId, remote as Record<string, unknown>);
          await databaseService.addAnnotationThread(normalized);
        },
        () => databaseService.addAnnotationThread(thread),
        'AnnotationThreadPanel.addThread',
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotation-threads', novelId, chapterId] });
      setNewThreadTitle('');
      setNewThreadContent('');
    },
  });

  const updateThreadMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AnnotationThread> }) => {
      const existing = threads?.find((t) => t.id === id);
      if (!existing) return;
      const merged: AnnotationThread = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await executeRemoteFirst(
        async () => {
          const remote = await novelApiService.updateInteraction(novelId, id, updates);
          const normalized = normalizeThread(novelId, remote as Record<string, unknown>);
          await databaseService.updateAnnotationThread(normalized);
        },
        () => databaseService.updateAnnotationThread(merged),
        'AnnotationThreadPanel.updateThread',
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotation-threads', novelId, chapterId] });
      setReplyingTo(null);
      setReplyContent('');
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (id: string) => {
      await executeRemoteFirst(
        () => novelApiService.deleteInteraction(novelId, id).then(() => undefined),
        () => databaseService.deleteAnnotationThread(id),
        'AnnotationThreadPanel.deleteThread',
        () => databaseService.deleteAnnotationThread(id),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotation-threads', novelId, chapterId] });
    },
  });

  const handleCreateThread = useCallback(() => {
    if (!newThreadTitle.trim()) return;
    addThreadMutation.mutate({
      title: newThreadTitle,
      content: newThreadContent,
      type: newThreadType,
    });
  }, [newThreadTitle, newThreadContent, newThreadType, addThreadMutation]);

  const handleAiTask = useCallback(async () => {
    if (!aiTaskPrompt.trim() || !aiTaskTarget.trim()) return;

    const thread: AnnotationThread = {
      id: `annotation-${crypto.randomUUID().slice(0, 12)}`,
      novelId,
      chapterId: chapterId || '',
      title: `AI 协作: ${aiTaskPrompt.slice(0, 30)}...`,
      content: aiTaskPrompt,
      type: 'ai_task',
      status: 'pending',
      aiTask: { prompt: aiTaskPrompt, status: 'pending' },
      mentions: ['ai-assistant'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await databaseService.addAnnotationThread(thread);
    queryClient.invalidateQueries({ queryKey: ['annotation-threads', novelId, chapterId] });

    updateThreadMutation.mutate({
      id: thread.id,
      updates: { aiTask: { prompt: aiTaskPrompt, status: 'running' }, status: 'in_progress' },
    });

    const targetThread = threads?.find((t) => t.id === aiTaskTarget);
    const contextText = targetThread?.content || aiTaskTarget;

    novelAiService.continueWriting(
      contextText,
      { taskPrompt: aiTaskPrompt, context: aiTaskPrompt },
      undefined,
      novelId,
    ).then((fullText) => {
      updateThreadMutation.mutate({
        id: thread.id,
        updates: { aiTask: { prompt: aiTaskPrompt, result: fullText, status: 'completed' }, status: 'resolved' },
      });
      emitNovelEvent('annotation_resolve', {
        novelId,
        threadId: thread.id,
        source: 'ai_task',
      });
      setAiTaskPrompt('');
      setAiTaskTarget('');
    }).catch(() => {
      updateThreadMutation.mutate({
        id: thread.id,
        updates: { aiTask: { prompt: aiTaskPrompt, status: 'failed' }, status: 'pending' },
      });
    });
  }, [aiTaskPrompt, aiTaskTarget, threads, updateThreadMutation, queryClient, novelId, chapterId]);

  const filteredThreads = useMemo(() => {
    if (!threads) return [];
    return [...threads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [threads]);
  const aiTaskThreads = useMemo(
    () => (threads ?? []).filter((thread) => thread.type === 'ai_task'),
    [threads]
  );

  const pendingCount = threads?.filter((t) => t.status === 'pending').length || 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <CardTitle>批注与协作</CardTitle>
            {pendingCount > 0 && (
              <Badge className="bg-yellow-100 text-yellow-800">{pendingCount} 待处理</Badge>
            )}
          </div>
        </div>
        <CardDescription>
          章节批注、讨论和 AI 协作任务
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'threads' | 'ai')}>
          <TabsList className="w-full">
            <TabsTrigger value="threads" className="flex-1">
              <MessageSquare className="mr-1 h-4 w-4" /> 批注线程
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex-1">
              <Sparkles className="mr-1 h-4 w-4" /> AI 协作
            </TabsTrigger>
          </TabsList>

          <TabsContent value="threads" className="space-y-4 mt-4">
            {/* New thread form */}
            <div className="space-y-3 p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <Input
                  placeholder="批注标题..."
                  value={newThreadTitle}
                  onChange={(e) => setNewThreadTitle(e.target.value)}
                />
              </div>
              <Select value={newThreadType} onValueChange={(v) => setNewThreadType(v as 'annotation' | 'ai_task' | 'discussion')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annotation">批注</SelectItem>
                  <SelectItem value="ai_task">AI 任务</SelectItem>
                  <SelectItem value="discussion">讨论</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="批注内容..."
                value={newThreadContent}
                onChange={(e) => setNewThreadContent(e.target.value)}
                rows={3}
              />
              {selectedText && (
                <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                  锚定文本: "{selectedText.slice(0, 50)}{selectedText.length > 50 ? '...' : ''}"
                </div>
              )}
              <Button
                onClick={handleCreateThread}
                disabled={addThreadMutation.isPending || !newThreadTitle.trim()}
                className="w-full"
              >
                {addThreadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                发布批注
              </Button>
            </div>

            {/* Thread list */}
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : filteredThreads.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <MessageSquare className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p>暂无批注，创建第一条批注开始协作</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredThreads.map((thread) => (
                  <div key={thread.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {thread.type === 'ai_task' ? <Bot className="h-4 w-4 text-purple-500" /> : <User className="h-4 w-4 text-muted-foreground" />}
                        <h4 className="font-medium text-sm">{thread.title}</h4>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge className={`text-xs ${statusColors[thread.status]}`}>
                          {statusLabels[thread.status]}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteThreadMutation.mutate(thread.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">{thread.content}</p>

                    {thread.anchorText && (
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded border-l-2 border-primary/30">
                        "{thread.anchorText.slice(0, 80)}{thread.anchorText.length > 80 ? '...' : ''}"
                      </div>
                    )}

                    {thread.aiTask?.result && (
                      <div className="p-2 bg-purple-50 border border-purple-200 rounded text-sm">
                        <div className="flex items-center gap-1 mb-1">
                          <Bot className="h-3 w-3 text-purple-500" />
                          <span className="font-medium text-xs text-purple-700">AI 回复</span>
                        </div>
                        <p className="text-xs text-purple-800">{thread.aiTask.result.slice(0, 200)}</p>
                      </div>
                    )}

                    {/* Reply form */}
                    {replyingTo === thread.id ? (
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="回复..."
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          className="flex-1"
                          rows={2}
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            updateThreadMutation.mutate({
                              id: thread.id,
                              updates: { content: thread.content + '\n\n回复: ' + replyContent },
                            });
                          }}
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => setReplyingTo(thread.id)}
                        >
                          <Reply className="mr-1 h-3 w-3" /> 回复
                        </Button>
                        {thread.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-green-600"
                            onClick={() => {
                              emitNovelEvent('annotation_resolve', {
                                novelId,
                                threadId: thread.id,
                                source: 'manual',
                              });
                              updateThreadMutation.mutate({
                                id: thread.id,
                                updates: { status: 'resolved' },
                              });
                            }}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> 标记已解决
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-4 mt-4">
            <div className="space-y-3 p-3 border rounded-lg">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                AI 协作任务
              </h4>
              <p className="text-xs text-muted-foreground">
                让 AI 帮你完成具体的创作任务，如补全伏笔、修正角色口吻、优化对话等。
              </p>
              <Select value={aiTaskTarget} onValueChange={setAiTaskTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="选择任务目标..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current-chapter">当前章节</SelectItem>
                  <SelectItem value="outline">大纲</SelectItem>
                  <SelectItem value="characters">角色设定</SelectItem>
                  <SelectItem value="dialogue">对话优化</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="描述你的任务，例如: '帮我补全第三章的伏笔，主角在地下室发现的信件应该在后续章节中发挥作用'..."
                value={aiTaskPrompt}
                onChange={(e) => setAiTaskPrompt(e.target.value)}
                rows={4}
              />
              <Button
                onClick={handleAiTask}
                disabled={!aiTaskPrompt.trim() || !aiTaskTarget}
                className="w-full"
              >
                <Sparkles className="mr-2 h-4 w-4" /> 启动 AI 协作
              </Button>
            </div>

            {/* AI task history */}
            {aiTaskThreads.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI 任务历史</h4>
                {aiTaskThreads.map((task) => (
                    <div key={task.id} className="p-3 border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Bot className="h-4 w-4 text-purple-500" />
                        <span className="text-sm font-medium">{task.title}</span>
                        <Badge className={`text-xs ml-auto ${statusColors[task.status]}`}>
                          {statusLabels[task.status]}
                        </Badge>
                      </div>
                      {task.aiTask?.result && (
                        <p className="text-xs text-muted-foreground mt-2">{task.aiTask.result.slice(0, 150)}...</p>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
