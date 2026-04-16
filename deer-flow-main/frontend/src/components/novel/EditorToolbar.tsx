'use client';

import { type Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
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
import { useI18n } from '@/core/i18n/hooks';
import { useAiPanelStore, useNovelStore } from '@/core/novel';
import { novelAiService } from '@/core/novel/ai-service';
import { useNovelQuery, useUpdateChapterMutation } from '@/core/novel/queries';
import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';

interface EditorToolbarProps {
  editor: Editor | null;
  className?: string;
}

export function EditorToolbar({ editor, className }: EditorToolbarProps) {
  const { t } = useI18n();
  const { data: novelData } = useNovelQuery('');
  const { activeChapterId } = useNovelStore();
  const updateChapterMutation = useUpdateChapterMutation();
  const { startStreaming, stopStreaming, aiStream } = useAiPanelStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  if (!editor) return null;

  const activeChapter = novelData?.chapters?.find((ch) => ch.id === activeChapterId);

  const isAnyPending = aiStream.isStreaming || isAnalyzing;

  const getSelectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  };

  const getTextBeforeCursor = () => {
    const { from } = editor.state.selection;
    const start = Math.max(0, from - 1000);
    return editor.state.doc.textBetween(start, from);
  };

  const handleReplaceText = async (action: 'polish' | 'expand' | 'condense' | 'rewrite') => {
    const selectedText = getSelectedText();
    if (!selectedText) return;

    const { from, to } = editor.state.selection;

    abortRef.current = new AbortController();
    startStreaming();

    try {
      let result: string;
      switch (action) {
        case 'polish':
          result = await novelAiService.polishText(selectedText);
          break;
        case 'expand':
          result = await novelAiService.expandScene(selectedText, {});
          break;
        case 'condense':
          result = await novelAiService.condenseText(selectedText);
          break;
        case 'rewrite':
          result = await novelAiService.rewriteText(selectedText);
          break;
        default:
          return;
      }

      if (result) {
        editor.chain().focus().insertContentAt({ from, to }, result).run();
      }
      stopStreaming();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        stopStreaming();
      } else {
        toast.error(`${action} 操作失败`, { description: '请稍后重试' });
        stopStreaming();
      }
    }
  };

  const handleContinueWriting = useCallback(async () => {
    if (!activeChapter || !activeChapterId) return;

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

      await novelAiService.continueWriting(prompt, {
        outline: activeChapter.description || '',
        content: textOnly,
      }, abortRef.current.signal);

      if (!selectedText) {
        editor.commands.focus('end');
      }
      stopStreaming();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error('续写失败', { description: '请稍后重试' });
      }
      stopStreaming();
    }
  }, [activeChapter, activeChapterId, editor, startStreaming, stopStreaming]);

  const handleAbort = () => {
    abortRef.current?.abort();
    stopStreaming();
  };

  const handleEntityAnalysis = async () => {
    const selectedText = getSelectedText();
    if (!selectedText) return;

    setIsAnalyzing(true);
    try {
      const entities = await novelAiService.extractEntities(selectedText);
      toast.success('实体分析完成', {
        description: `角色: ${entities.characters?.length || 0}个, 场景: ${entities.settings?.length || 0}个`,
      });
    } catch (error) {
      toast.error('实体分析失败', { description: '请稍后重试' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const buttons = [
    {
      icon: <Undo2 className="h-4 w-4" />,
      label: 'Undo',
      action: () => editor.chain().focus().undo().run(),
      isActive: false,
    },
    {
      icon: <Redo2 className="h-4 w-4" />,
      label: 'Redo',
      action: () => editor.chain().focus().redo().run(),
      isActive: false,
    },
    { type: 'separator' as const },
    {
      icon: <Bold className="h-4 w-4" />,
      label: 'Bold',
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: editor.isActive('bold'),
    },
    {
      icon: <Italic className="h-4 w-4" />,
      label: 'Italic',
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: editor.isActive('italic'),
    },
    {
      icon: <Strikethrough className="h-4 w-4" />,
      label: 'Strike',
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: editor.isActive('strike'),
    },
    { type: 'separator' as const },
    {
      icon: <Heading1 className="h-4 w-4" />,
      label: 'H1',
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: editor.isActive('heading', { level: 1 }),
    },
    {
      icon: <Heading2 className="h-4 w-4" />,
      label: 'H2',
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: editor.isActive('heading', { level: 2 }),
    },
    {
      icon: <Heading3 className="h-4 w-4" />,
      label: 'H3',
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: editor.isActive('heading', { level: 3 }),
    },
    { type: 'separator' as const },
    {
      icon: <List className="h-4 w-4" />,
      label: 'Bullet List',
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: editor.isActive('bulletList'),
    },
    {
      icon: <ListOrdered className="h-4 w-4" />,
      label: 'Ordered List',
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: editor.isActive('orderedList'),
    },
    {
      icon: <Quote className="h-4 w-4" />,
      label: 'Blockquote',
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: editor.isActive('blockquote'),
    },
    { type: 'separator' as const },
    {
      icon: <MessageSquare className="h-4 w-4" />,
      label: 'Continue',
      action: handleContinueWriting,
      isActive: false,
      isAi: true as const,
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      label: 'Polish',
      action: () => handleReplaceText('polish'),
      isActive: false,
      isAi: true as const,
    },
    {
      icon: <PenTool className="h-4 w-4" />,
      label: 'Expand',
      action: () => handleReplaceText('expand'),
      isActive: false,
      isAi: true as const,
    },
    {
      icon: <Languages className="h-4 w-4" />,
      label: 'Condense',
      action: () => handleReplaceText('condense'),
      isActive: false,
      isAi: true as const,
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      label: 'Rewrite',
      action: () => handleReplaceText('rewrite'),
      isActive: false,
      isAi: true as const,
    },
    {
      icon: <Search className="h-4 w-4" />,
      label: 'Analyze',
      action: handleEntityAnalysis,
      isActive: false,
      isAi: true as const,
    },
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-1 border-b bg-muted/50 px-3 py-2', className)}>
      {buttons.map((btn, index) =>
        btn.type === 'separator' ? (
          <div key={`sep-${index}`} className="mx-1 h-5 w-px bg-border" />
        ) : (
          <button
            key={btn.label}
            onClick={btn.action}
            disabled={isAnyPending}
            title={btn.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
              btn.isActive && 'bg-accent text-accent-foreground',
              (btn as any).isAi && 'text-muted-foreground hover:text-foreground',
              isAnyPending && 'opacity-50 cursor-not-allowed'
            )}
          >
            {btn.icon}
          </button>
        )
      )}
      {(aiStream.isStreaming || isAnalyzing) && (
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
