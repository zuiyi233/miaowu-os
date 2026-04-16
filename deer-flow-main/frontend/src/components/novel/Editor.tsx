'use client';

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import { useNovelStore, useAiPanelStore } from '@/core/novel';
import { useNovelQuery, useUpdateChapterMutation } from '@/core/novel/queries';
import { EditorToolbar } from './EditorToolbar';
import { AiActionToolbar } from './AiActionToolbar';
import { ChapterInfoCard } from './editor/ChapterInfoCard';
import { useDebounce } from '@/core/novel/useDebounce';
import { cn } from '@/lib/utils';

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
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      CharacterCount.configure({ limit: null }),
    ],
    content: activeChapter?.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert max-w-none focus:outline-none leading-relaxed',
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
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-hidden">
        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8 flex flex-col h-full">
          {activeChapter && <ChapterInfoCard chapter={activeChapter} />}
          <div className="editor-area rounded-lg border bg-card p-6 sm:p-8 flex-1 overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
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
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span>Words: {editor.storage.characterCount.words()} | Chars: {editor.storage.characterCount.characters()}</span>
        </div>
      )}
      {editor && <AiActionToolbar editor={editor} />}
    </div>
  );
}
