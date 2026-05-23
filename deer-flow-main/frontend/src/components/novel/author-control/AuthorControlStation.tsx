'use client';

import {
  Check,
  ClipboardList,
  Eye,
  GitCompare,
  ListChecks,
  Loader2,
  PenLine,
  RotateCcw,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  type AuthorContextPreview,
  type NovelDraftVersion,
  type NovelIssue,
  novelApiService,
  type SceneCard,
} from '@/core/novel/novel-api';
import type { Chapter } from '@/core/novel/schemas';
import { useNovelQuery } from '@/core/novel/queries';
import { cn } from '@/lib/utils';

const actionOptions = [
  { value: 'continue', label: '续写' },
  { value: 'expand', label: '扩写' },
  { value: 'compress', label: '压缩' },
  { value: 'dialogue', label: '对白' },
  { value: 'describe', label: '描写' },
  { value: 'change_pov', label: '换 POV' },
  { value: 'polish', label: '润色' },
];

function pickFirstChapter(chapters: Chapter[]) {
  return [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

function chapterStatus(chapter: Chapter | undefined) {
  if (!chapter) return '未选择';
  const raw = (chapter as unknown as { status?: unknown }).status;
  return typeof raw === 'string' && raw ? raw : 'draft';
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300';
  if (severity === 'high') return 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  if (severity === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

interface AuthorControlStationProps {
  novelId: string;
}

export function AuthorControlStation({ novelId }: AuthorControlStationProps) {
  const { data: novel, refetch } = useNovelQuery(novelId);
  const chapters = novel?.chapters ?? [];
  const [chapterId, setChapterId] = useState('');
  const [instruction, setInstruction] = useState('承接上一段，推进冲突，同时保持角色状态一致。');
  const [selectedText, setSelectedText] = useState('');
  const [action, setAction] = useState('continue');
  const [contextPreview, setContextPreview] = useState<AuthorContextPreview | null>(null);
  const [scenes, setScenes] = useState<SceneCard[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [issues, setIssues] = useState<NovelIssue[]>([]);
  const [versions, setVersions] = useState<NovelDraftVersion[]>([]);
  const [candidateText, setCandidateText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const currentChapter = useMemo(
    () => chapters.find((item) => item.id === chapterId) ?? pickFirstChapter(chapters),
    [chapterId, chapters],
  );
  const selectedScene = scenes.find((item) => item.id === selectedSceneId) ?? scenes[0];
  const openIssueCount = issues.filter((item) => item.status === 'open').length;
  const latestCandidate = versions.find((item) => item.status === 'candidate');

  useEffect(() => {
    if (!chapterId && currentChapter?.id) {
      setChapterId(currentChapter.id);
    }
  }, [chapterId, currentChapter?.id]);

  useEffect(() => {
    if (!currentChapter?.id) return;
    void refreshChapterSideData(currentChapter.id);
  }, [currentChapter?.id]);

  async function refreshChapterSideData(nextChapterId = currentChapter?.id) {
    if (!nextChapterId) return;
    const [sceneItems, issueItems, versionItems] = await Promise.all([
      novelApiService.getSceneCards(novelId, nextChapterId).catch(() => []),
      novelApiService.getAuthorIssues(novelId).catch(() => []),
      novelApiService.getDraftVersions(nextChapterId).catch(() => []),
    ]);
    setScenes(sceneItems);
    setSelectedSceneId((existing) => existing || sceneItems[0]?.id || '');
    setIssues(issueItems);
    setVersions(versionItems);
  }

  async function runWithBusy(label: string, task: () => Promise<void>) {
    setBusy(label);
    setMessage('');
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function previewContext() {
    if (!currentChapter?.id) return;
    await runWithBusy('context', async () => {
      const preview = await novelApiService.previewAuthorContext(novelId, {
        chapter_id: currentChapter.id,
        task_kind: action,
        user_instruction: instruction,
        selected_text: selectedText || undefined,
      });
      setContextPreview(preview);
    });
  }

  async function planScenes() {
    if (!currentChapter?.id) return;
    await runWithBusy('plan', async () => {
      const result = await novelApiService.planSceneCards(novelId, currentChapter.id, {
        user_instruction: instruction,
        scene_count: 5,
      });
      setScenes(result.items);
      setSelectedSceneId(result.items[0]?.id || '');
      setMessage(`场景计划已生成，context ${result.context_hash ?? '-'}`);
    });
  }

  async function generateScene() {
    if (!selectedScene?.id) return;
    await runWithBusy('generate', async () => {
      setCandidateText('');
      const stream = await novelApiService.generateSceneStream(selectedScene.id, {
        instruction,
        target_word_count: selectedScene.target_word_count ?? 800,
      });
      let accumulated = '';
      for await (const event of stream) {
        const type = String(event.type ?? '');
        if ((type === 'content' || type === 'chunk') && typeof event.content === 'string') {
          accumulated += event.content;
          setCandidateText(accumulated);
        }
        if (type === 'result' && typeof event.content === 'string') {
          setCandidateText(event.content);
        }
      }
      await refreshChapterSideData();
    });
  }

  async function reviseChapter(issue?: NovelIssue) {
    if (!currentChapter?.id) return;
    await runWithBusy('revise', async () => {
      const result = await novelApiService.reviseChapter(currentChapter.id, {
        selected_text: issue?.evidence_text || selectedText || undefined,
        issue_ids: issue ? [issue.id] : [],
        instruction: issue?.suggestion || instruction,
        preserve_elements: [],
      });
      setVersions((items) => [result.version, ...items.filter((item) => item.id !== result.version.id)]);
      setCandidateText(result.version.candidate_content);
    });
  }

  async function critiqueChapter() {
    if (!currentChapter?.id) return;
    await runWithBusy('critique', async () => {
      const result = await novelApiService.critiqueChapter(novelId, currentChapter.id, {
        instruction,
      });
      setIssues(result.items);
      setMessage(`审校完成，发现 ${result.items.length} 个问题`);
    });
  }

  async function acceptVersion(versionId: string) {
    await runWithBusy('accept', async () => {
      await novelApiService.acceptDraftVersion(versionId);
      await Promise.all([refreshChapterSideData(), refetch()]);
      setMessage('候选已接受并写回章节。');
    });
  }

  async function rejectVersion(versionId: string) {
    await runWithBusy('reject', async () => {
      await novelApiService.rejectDraftVersion(versionId);
      await refreshChapterSideData();
    });
  }

  async function rollbackVersion(versionId: string) {
    await runWithBusy('rollback', async () => {
      await novelApiService.rollbackDraftVersion(versionId);
      await Promise.all([refreshChapterSideData(), refetch()]);
    });
  }

  const isBusy = (key: string) => busy === key;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">作者控制台</h1>
          <p className="truncate text-xs text-muted-foreground">诊断、场景、续写、审校、修订和版本回滚的纵向闭环</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 max-w-[16rem] rounded-md border bg-background px-2 text-sm"
            value={currentChapter?.id ?? ''}
            onChange={(event) => setChapterId(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={previewContext} disabled={!currentChapter || Boolean(busy)}>
            {isBusy('context') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            预览上下文
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside className="min-h-0 border-b bg-muted/10 lg:border-b-0 lg:border-r">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ClipboardList className="h-4 w-4" />作品诊断
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-muted-foreground">章节字数</p>
                    <p className="text-lg font-semibold">{currentChapter?.wordCount ?? currentChapter?.content?.length ?? 0}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-muted-foreground">开放 issue</p>
                    <p className="text-lg font-semibold">{openIssueCount}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-muted-foreground">场景卡</p>
                    <p className="text-lg font-semibold">{scenes.length}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-muted-foreground">候选版本</p>
                    <p className="text-lg font-semibold">{versions.filter((item) => item.status === 'candidate').length}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ListChecks className="h-4 w-4" />场景卡
                  </div>
                  <Button variant="outline" size="sm" onClick={planScenes} disabled={!currentChapter || Boolean(busy)}>
                    {isBusy('plan') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    计划
                  </Button>
                </div>
                <div className="space-y-2">
                  {scenes.map((scene) => (
                    <button
                      key={scene.id}
                      className={cn(
                        'w-full rounded-md border bg-background p-2 text-left text-sm hover:border-primary/60',
                        selectedScene?.id === scene.id && 'border-primary bg-primary/5',
                      )}
                      onClick={() => setSelectedSceneId(scene.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{scene.order_index}. {scene.title}</span>
                        <Badge variant="outline">{scene.draft_status}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{scene.scene_goal || scene.conflict}</p>
                    </button>
                  ))}
                  {scenes.length === 0 && (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">还没有场景卡。先点击“计划”。</p>
                  )}
                </div>
              </section>
            </div>
          </ScrollArea>
        </aside>

        <main className="min-h-0 border-b lg:border-b-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b p-3">
              <div className="mb-2 flex flex-wrap gap-1">
                {actionOptions.map((item) => (
                  <Button
                    key={item.value}
                    size="sm"
                    variant={action === item.value ? 'default' : 'outline'}
                    onClick={() => setAction(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                className="min-h-20 resize-none"
                placeholder="输入本次写作动作的控制要求"
              />
              <Textarea
                value={selectedText}
                onChange={(event) => setSelectedText(event.target.value)}
                className="mt-2 min-h-16 resize-none"
                placeholder="可选：粘贴选区文本，用于局部续写/修订"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={generateScene} disabled={!selectedScene || Boolean(busy)}>
                  {isBusy('generate') ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                  生成场景正文候选
                </Button>
                <Button size="sm" variant="outline" onClick={() => reviseChapter()} disabled={!currentChapter || Boolean(busy)}>
                  {isBusy('revise') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                  生成修订候选
                </Button>
                <Button size="sm" variant="outline" onClick={critiqueChapter} disabled={!currentChapter || Boolean(busy)}>
                  {isBusy('critique') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  审校当前章节
                </Button>
              </div>
              {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
              <ScrollArea className="min-h-0 border-b md:border-b-0 md:border-r">
                <section className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-medium">章节草稿</h2>
                    <Badge variant="outline">{chapterStatus(currentChapter)}</Badge>
                  </div>
                  <pre className="min-h-80 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-6">
                    {currentChapter?.content || '当前章节没有正文。'}
                  </pre>
                </section>
              </ScrollArea>
              <ScrollArea className="min-h-0">
                <section className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-medium">生成候选</h2>
                    {latestCandidate && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => acceptVersion(latestCandidate.id)} disabled={Boolean(busy)}>
                          <Check className="h-4 w-4" />接受
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => rejectVersion(latestCandidate.id)} disabled={Boolean(busy)}>
                          <X className="h-4 w-4" />拒绝
                        </Button>
                      </div>
                    )}
                  </div>
                  <pre className="min-h-80 whitespace-pre-wrap rounded-md border bg-background p-3 text-sm leading-6">
                    {candidateText || latestCandidate?.candidate_content || '生成候选会出现在这里，不会直接覆盖原文。'}
                  </pre>
                </section>
              </ScrollArea>
            </div>
          </div>
        </main>

        <aside className="min-h-0 bg-muted/10">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Eye className="h-4 w-4" />上下文包
                </div>
                {contextPreview ? (
                  <div className="space-y-2 text-xs">
                    <div className="rounded-md border bg-background p-2">
                      <p>context_hash: <span className="font-mono">{contextPreview.context_hash}</span></p>
                      <p>estimated_tokens: {contextPreview.estimated_tokens}</p>
                    </div>
                    <details className="rounded-md border bg-background p-2" open>
                      <summary className="cursor-pointer font-medium">RAG 命中 {contextPreview.rag_hits.length}</summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(contextPreview.rag_hits, null, 2)}</pre>
                    </details>
                    <details className="rounded-md border bg-background p-2">
                      <summary className="cursor-pointer font-medium">角色状态 {contextPreview.character_states.length}</summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(contextPreview.character_states, null, 2)}</pre>
                    </details>
                    <details className="rounded-md border bg-background p-2">
                      <summary className="cursor-pointer font-medium">伏笔 {contextPreview.foreshadows.length}</summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(contextPreview.foreshadows, null, 2)}</pre>
                    </details>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">点击“预览上下文”查看 AI 本次将参考的内容。</p>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ListChecks className="h-4 w-4" />证据化审校
                </div>
                {issues.map((issue) => (
                  <div key={issue.id} className="space-y-2 rounded-md border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{issue.title}</span>
                      <span className={cn('rounded border px-1.5 py-0.5', severityClass(issue.severity))}>{issue.severity}</span>
                    </div>
                    <p className="text-muted-foreground">{issue.description}</p>
                    <blockquote className="border-l-2 pl-2 text-muted-foreground">{issue.evidence_text || '无证据文本'}</blockquote>
                    <p>{issue.conflicting_fact}</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => reviseChapter(issue)} disabled={Boolean(busy)}>
                        <Wrench className="h-4 w-4" />修复
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => novelApiService.updateAuthorIssue(issue.id, { status: 'ignored' }).then(() => refreshChapterSideData())}>
                        忽略
                      </Button>
                    </div>
                  </div>
                ))}
                {issues.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">还没有审校问题。</p>}
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <GitCompare className="h-4 w-4" />版本与 Diff
                </div>
                {versions.map((version) => (
                  <div key={version.id} className="space-y-2 rounded-md border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{version.context_hash ?? version.id.slice(0, 8)}</span>
                      <Badge variant="outline">{version.status}</Badge>
                    </div>
                    <p>{version.diff_summary}</p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">
                      {(version.diff_payload.lines ?? []).slice(0, 40).join('\n')}
                    </pre>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => acceptVersion(version.id)} disabled={version.status !== 'candidate' || Boolean(busy)}>
                        <Check className="h-4 w-4" />接受
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => rejectVersion(version.id)} disabled={version.status !== 'candidate' || Boolean(busy)}>
                        <X className="h-4 w-4" />拒绝
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => rollbackVersion(version.id)} disabled={Boolean(busy)}>
                        <RotateCcw className="h-4 w-4" />回滚
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
