'use client';

import { type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  MessageSquare,
  Sparkles,
  PenTool,
  Languages,
  X,
  Search,
} from 'lucide-react';
import { useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useAiPanelStore, useNovelStore } from '@/core/novel';
import { novelAiService } from '@/core/novel/ai-service';
import { useNovelQuery } from '@/core/novel/queries';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  editor: Editor | null;
  novelId: string;
  className?: string;
}

type ReplaceAction = 'polish' | 'expand' | 'condense' | 'rewrite';

type ToolbarButtonItem =
  | {
      type: 'separator';
      key: string;
    }
  | {
      type: 'button';
      icon: ReactNode;
      label: string;
      action: () => void;
      isActive: boolean;
      isAi?: boolean;
    };

export function EditorToolbar({ editor, novelId, className }: EditorToolbarProps) {
  const { data: novelData } = useNovelQuery(novelId);
  const activeChapterId = useNovelStore((state) => state.activeChapterId);
  const startStreaming = useAiPanelStore((state) => state.startStreaming);
  const stopStreaming = useAiPanelStore((state) => state.stopStreaming);
  const addChunk = useAiPanelStore((state) => state.addChunk);
  const isStreaming = useAiPanelStore((state) => state.aiStream.isStreaming);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeChapter = useMemo(
    () => novelData?.chapters?.find((ch) => ch.id === activeChapterId),
    [novelData?.chapters, activeChapterId]
  );

  const getSelectedText = useCallback(() => {
    if (!editor) return '';
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  }, [editor]);

  const getTextBeforeCursor = useCallback(() => {
    if (!editor) return '';
    const { from } = editor.state.selection;
    const start = Math.max(0, from - 1000);
    return editor.state.doc.textBetween(start, from);
  }, [editor]);

  const handleContinueWriting = useCallback(async () => {
    if (!activeChapter || !activeChapterId || !editor) return;

    const selectedText = getSelectedText();
    const textBeforeCursor = getTextBeforeCursor();
    const contextText = selectedText || textBeforeCursor;

    if (!contextText.trim()) return;

    abortRef.current = new AbortController();
    startStreaming();

    try {
      const fullContent = activeChapter.content || '';
      const textOnly = fullContent.replace(/<[^>]*>/g, '');

      const prompt = selectedText
        ? contextText
        : `请继续以下章节的内容，保持情节连贯：\n\n${textOnly}`;

      await novelAiService.chat(
        {
          messages: [
            {
              role: 'system',
              content: `你是一个小说续写助手。基于以下上下文信息，继续写故事。保持角色性格一致，情节连贯。
大纲：${activeChapter.description || ''}
原文：${textOnly}`,
            },
            {
              role: 'user',
              content: `请继续以下章节的内容：\n${prompt}`,
            },
          ],
          novelId,
          stream: true,
        },
        {
          onChunk: (chunk) => {
            addChunk(chunk);
          },
          onComplete: (fullText) => {
            if (fullText) {
              if (!selectedText) {
                editor.commands.insertContent(fullText);
                editor.commands.focus('end');
              } else {
                editor.chain().focus().insertContent(fullText).run();
              }
            }
            abortRef.current = null;
            stopStreaming();
          },
          onError: (error) => {
            toast.error('续写失败', { description: error.message });
            abortRef.current = null;
            stopStreaming();
          },
          onAbort: () => {
            abortRef.current = null;
            stopStreaming();
          },
          abortSignal: abortRef.current.signal,
        }
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error('续写失败', { description: '请稍后重试' });
      }
      abortRef.current = null;
      stopStreaming();
    }
  }, [
    activeChapter,
    activeChapterId,
    addChunk,
    editor,
    getSelectedText,
    getTextBeforeCursor,
    novelId,
    startStreaming,
    stopStreaming,
  ]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopStreaming();
  }, [stopStreaming]);

  const handleReplaceText = useCallback(
    async (action: ReplaceAction) => {
      if (!editor) return;

      const selectedText = getSelectedText();
      if (!selectedText) return;

      const { from, to } = editor.state.selection;

      abortRef.current = new AbortController();
      startStreaming();

      try {
        await novelAiService.chat(
          {
            messages: [
              {
                role: 'system',
                content: getSystemPrompt(action),
              },
              {
                role: 'user',
                content: getUserContent(action, selectedText),
              },
            ],
            novelId,
            stream: true,
          },
          {
            onChunk: (chunk) => {
              addChunk(chunk);
            },
            onComplete: (fullText) => {
              if (fullText) {
                editor.chain().focus().insertContentAt({ from, to }, fullText).run();
              }
              abortRef.current = null;
              stopStreaming();
            },
            onError: (error) => {
              toast.error(`${action} 操作失败`, { description: error.message });
              abortRef.current = null;
              stopStreaming();
            },
            onAbort: () => {
              abortRef.current = null;
              stopStreaming();
            },
            abortSignal: abortRef.current.signal,
          }
        );
      } catch (_error) {
        if (_error instanceof DOMException && _error.name === 'AbortError') {
          abortRef.current = null;
          stopStreaming();
        } else {
          toast.error(`${action} 操作失败`, { description: '请稍后重试' });
          abortRef.current = null;
          stopStreaming();
        }
      }
    },
    [addChunk, editor, getSelectedText, novelId, startStreaming, stopStreaming]
  );

  const handleEntityAnalysis = useCallback(async () => {
    const selectedText = getSelectedText();
    if (!selectedText) return;

    setIsAnalyzing(true);
    try {
      const entities = await novelAiService.extractEntities(selectedText);
      toast.success('实体分析完成', {
        description: `角色: ${entities.characters?.length || 0}个, 场景: ${entities.settings?.length || 0}个`,
      });
    } catch {
      toast.error('实体分析失败', { description: '请稍后重试' });
    } finally {
      setIsAnalyzing(false);
    }
  }, [getSelectedText]);

  const isAnyPending = isStreaming || isAnalyzing;

  const buttons: ToolbarButtonItem[] = editor
    ? [
      {
        type: 'button',
        icon: <Undo2 className="h-4 w-4" />,
        label: 'Undo',
        action: () => editor.chain().focus().undo().run(),
        isActive: false,
      },
      {
        type: 'button',
        icon: <Redo2 className="h-4 w-4" />,
        label: 'Redo',
        action: () => editor.chain().focus().redo().run(),
        isActive: false,
      },
      { type: 'separator', key: 'sep-history' },
      {
        type: 'button',
        icon: <Bold className="h-4 w-4" />,
        label: 'Bold',
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: editor.isActive('bold'),
      },
      {
        type: 'button',
        icon: <Italic className="h-4 w-4" />,
        label: 'Italic',
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: editor.isActive('italic'),
      },
      {
        type: 'button',
        icon: <Strikethrough className="h-4 w-4" />,
        label: 'Strike',
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: editor.isActive('strike'),
      },
      { type: 'separator', key: 'sep-inline' },
      {
        type: 'button',
        icon: <Heading1 className="h-4 w-4" />,
        label: 'H1',
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: editor.isActive('heading', { level: 1 }),
      },
      {
        type: 'button',
        icon: <Heading2 className="h-4 w-4" />,
        label: 'H2',
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: editor.isActive('heading', { level: 2 }),
      },
      {
        type: 'button',
        icon: <Heading3 className="h-4 w-4" />,
        label: 'H3',
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: editor.isActive('heading', { level: 3 }),
      },
      { type: 'separator', key: 'sep-heading' },
      {
        type: 'button',
        icon: <List className="h-4 w-4" />,
        label: 'Bullet List',
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: editor.isActive('bulletList'),
      },
      {
        type: 'button',
        icon: <ListOrdered className="h-4 w-4" />,
        label: 'Ordered List',
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: editor.isActive('orderedList'),
      },
      {
        type: 'button',
        icon: <Quote className="h-4 w-4" />,
        label: 'Blockquote',
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: editor.isActive('blockquote'),
      },
      { type: 'separator', key: 'sep-ai' },
      {
        type: 'button',
        icon: <MessageSquare className="h-4 w-4" />,
        label: 'Continue',
        action: handleContinueWriting,
        isActive: false,
        isAi: true,
      },
      {
        type: 'button',
        icon: <Sparkles className="h-4 w-4" />,
        label: 'Polish',
        action: () => handleReplaceText('polish'),
        isActive: false,
        isAi: true,
      },
      {
        type: 'button',
        icon: <PenTool className="h-4 w-4" />,
        label: 'Expand',
        action: () => handleReplaceText('expand'),
        isActive: false,
        isAi: true,
      },
      {
        type: 'button',
        icon: <Languages className="h-4 w-4" />,
        label: 'Condense',
        action: () => handleReplaceText('condense'),
        isActive: false,
        isAi: true,
      },
      {
        type: 'button',
        icon: <Sparkles className="h-4 w-4" />,
        label: 'Rewrite',
        action: () => handleReplaceText('rewrite'),
        isActive: false,
        isAi: true,
      },
      {
        type: 'button',
        icon: <Search className="h-4 w-4" />,
        label: 'Analyze',
        action: handleEntityAnalysis,
        isActive: false,
        isAi: true,
      },
    ]
    : [];

  if (!editor) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1 border-b bg-muted/50 px-3 py-2', className)}>
      {buttons.map((btn) =>
        btn.type === 'separator' ? (
          <div key={btn.key} className="mx-1 h-5 w-px bg-border" />
        ) : (
          <button
            key={btn.label}
            onClick={btn.action}
            disabled={isAnyPending}
            title={btn.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
              btn.isActive && 'bg-accent text-accent-foreground',
              btn.isAi && 'text-muted-foreground hover:text-foreground',
              isAnyPending && 'opacity-50 cursor-not-allowed'
            )}
          >
            {btn.icon}
          </button>
        )
      )}
      {isAnyPending && (
        <button
          onClick={handleAbort}
          title="取消"
          className="flex h-8 w-8 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function getSystemPrompt(action: ReplaceAction): string {
  switch (action) {
    case 'polish':
      return '你是一个专业的文字润色助手。改进文字表达的流畅度、用词准确性和文学性，但不要改变原文的核心意思。';
    case 'expand':
      return '你是一个场景扩写助手。将简短的场景描述扩写成详细的叙述，增加细节和情感描写。';
    case 'condense':
      return '你是一个文字精简助手。请将段落精简压缩，保留核心情节和关键信息，去除冗余描写。不要改变原文的核心意思。';
    case 'rewrite':
      return '你是一个文字改写助手。请用更加生动、引人入胜的方式重写以下段落，保持原意不变但提升文学性和可读性。';
    default:
      return '';
  }
}

function getUserContent(action: ReplaceAction, text: string): string {
  switch (action) {
    case 'polish':
      return `请润色以下文字：\n${text}`;
    case 'expand':
      return `请扩写以下场景：\n${text}`;
    case 'condense':
      return `请精简以下文字：\n${text}`;
    case 'rewrite':
      return `请重写以下文字：\n${text}`;
    default:
      return '';
  }
}
