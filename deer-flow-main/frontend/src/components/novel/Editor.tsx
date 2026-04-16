'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import { useNovelStore, useAiPanelStore, useEditorStore } from '@/core/novel';
import { useNovelQuery, useUpdateChapterMutation } from '@/core/novel/queries';
import { EditorToolbar } from './EditorToolbar';
import { AiActionToolbar } from './AiActionToolbar';
import { ChapterInfoCard } from './editor/ChapterInfoCard';
import { useDebounce } from '@/core/novel/useDebounce';

const FloatingToolbarWrapper: React.FC<{ editor: ReturnType<typeof useEditor> }> = ({ editor }) => {
  const { isVisible, x, y } = useFloatingToolbarLogic(editor);

  if (!isVisible || !editor) return null;

  return (
    <div
      className="fixed z-50 rounded-lg border bg-popover shadow-lg"
      style={{ left: `${x}px`, top: `${y}px`, transform: 'translateX(-50%)' }}
    >
      <AiActionToolbar editor={editor} />
    </div>
  );
};

function useFloatingToolbarLogic(editor: ReturnType<typeof useEditor>) {
  const [state, setState] = React.useState({ isVisible: false, x: 0, y: 0, selectedText: '' });

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, ' ');

      if (selectedText.length > 0) {
        const view = editor.view;
        const coords = view.coordsAtPos(from);
        const domRect = view.dom.getBoundingClientRect();

        setState({
          isVisible: true,
          x: coords.left - domRect.left + (coords.right - coords.left) / 2,
          y: coords.top - domRect.top - 50,
          selectedText,
        });
      } else {
        setState((prev) => ({ ...prev, isVisible: false }));
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor]);

  return state;
}

export function NovelEditor({ novelTitle }: { novelTitle: string }) {
  const { activeChapterId, dirtyContent, setDirtyContent } = useNovelStore();
  const aiStream = useAiPanelStore((s) => s.aiStream);
  const { data: novelData, isLoading } = useNovelQuery(novelTitle);
  const updateChapterMutation = useUpdateChapterMutation();
  const previousChapterRef = useRef<{ id: string; content: string | null }>({ id: '', content: null });

  const { chapters = [] } = novelData || {};
  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  useEffect(() => {
    previousChapterRef.current = { id: activeChapterId || '', content: dirtyContent };
  });

  const debouncedSave = useDebounce(
    (content: string) => {
      if (activeChapterId) {
        updateChapterMutation.mutate({ chapterId: activeChapterId, content });
        setDirtyContent(null);
      }
    },
    1000
  );

  useEffect(() => {
    if (dirtyContent !== null) {
      debouncedSave(dirtyContent);
    }
  }, [dirtyContent, debouncedSave]);

  useEffect(() => {
    const previousChapter = previousChapterRef.current;
    if (previousChapter && previousChapter.content !== null && previousChapter.id) {
      debouncedSave.cancel();
      updateChapterMutation.mutate({
        chapterId: previousChapter.id,
        content: previousChapter.content,
      });
      setDirtyContent(null);
    }

    if (editor) {
      const newContent = chapters.find((ch) => ch.id === activeChapterId)?.content || '';
      if (editor.getHTML() !== newContent) {
        editor.commands.setContent(newContent, { emitUpdate: false });
      }
    }
  }, [activeChapterId]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      CharacterCount.configure({ limit: null }),
    ],
    content: activeChapter?.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert focus:outline-none w-full leading-relaxed max-w-none prose-headings:font-bold prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic prose-ul:list-disc prose-ol:list-decimal',
      },
    },
    onUpdate: ({ editor }) => {
      if (!aiStream.isStreaming) {
        setDirtyContent(editor.getHTML());
      }
    },
  });

  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !aiStream.isStreaming && editor) {
      setDirtyContent(editor.getHTML());
    }
    wasStreamingRef.current = aiStream.isStreaming;
  }, [aiStream.isStreaming, editor, setDirtyContent]);

  useEffect(() => {
    if (!editor) return;
    if (aiStream.isStreaming && aiStream.latestChunk) {
      const formattedChunk = aiStream.latestChunk.replace(/\n/g, '<br/>');
      editor.chain().setMeta('addToHistory', false).insertContent(formattedChunk).scrollIntoView().run();
    }
  }, [aiStream.seq, aiStream.isStreaming, aiStream.latestChunk, editor]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!novelData) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No novel data found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex w-full flex-1 justify-center overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="mb-6 font-['Lora'] text-4xl font-bold tracking-tight">
            {activeChapter?.title}
          </h1>
          {activeChapter && <ChapterInfoCard chapter={activeChapter} />}
          <EditorToolbar editor={editor} className="mb-8" />
          <EditorContent editor={editor} />
          {editor && <FloatingToolbarWrapper editor={editor} />}
        </div>
      </div>
      {aiStream.isStreaming && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="text-lg font-medium">AI is writing...</div>
          </div>
        </div>
      )}
      {editor && (
        <div className="border-t p-2 text-right text-sm text-muted-foreground">
          Words: {editor.storage.characterCount.words()} | Chars:{' '}
          {editor.storage.characterCount.characters()}
        </div>
      )}
    </div>
  );
}
