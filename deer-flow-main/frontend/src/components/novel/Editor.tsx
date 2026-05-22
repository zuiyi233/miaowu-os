'use client';

import CharacterCount from '@tiptap/extension-character-count';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

import { useNovelStore, useAiPanelStore } from '@/core/novel';
import { useNovelQuery, useUpdateChapterMutation } from '@/core/novel/queries';
import { useDebounce } from '@/core/novel/useDebounce';

import { ChapterInfoCard } from './editor/ChapterInfoCard';
import { EditorToolbar } from './EditorToolbar';

export function NovelEditor({ novelId }: { novelId: string }) {
  const activeChapterId = useNovelStore((s) => s.activeChapterId);
  const dirtyContent = useNovelStore((s) => s.dirtyContent);
  const setDirtyContent = useNovelStore((s) => s.setDirtyContent);
  const aiStream = useAiPanelStore((s) => s.aiStream);
  const { data: novelData, isLoading } = useNovelQuery(novelId);
  const updateChapterMutation = useUpdateChapterMutation();

  const { chapters = [] } = novelData ?? {};
  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  // Always mirror the latest dirtyContent into a ref so the chapter-switch
  // effect can flush the previous chapter without going stale.
  const latestDirtyRef = useRef<string | null>(null);
  useEffect(() => {
    latestDirtyRef.current = dirtyContent;
  }, [dirtyContent]);

  const debouncedSave = useDebounce(
    (content: string) => {
      if (activeChapterId) {
        updateChapterMutation.mutate({ chapterId: activeChapterId, content, novelId });
        setDirtyContent(null);
      }
    },
    1000,
  );

  // Auto save (debounced) while editing the current chapter.
  useEffect(() => {
    if (dirtyContent !== null) {
      debouncedSave(dirtyContent);
    }
  }, [dirtyContent, debouncedSave]);

  // On chapter switch: flush any pending dirty content of the *previous* chapter
  // synchronously to the correct chapterId, then reset dirty state.
  const lastChapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousId = lastChapterIdRef.current;
    const previousContent = latestDirtyRef.current;

    if (previousId && previousId !== activeChapterId && previousContent !== null) {
      debouncedSave.cancel();
      updateChapterMutation.mutate({
        chapterId: previousId,
        content: previousContent,
        novelId,
      });
    }

    lastChapterIdRef.current = activeChapterId ?? null;
    latestDirtyRef.current = null;
    setDirtyContent(null);
  }, [activeChapterId, novelId, debouncedSave, updateChapterMutation, setDirtyContent]);

  // Tiptap: use chapterId as a dependency so the editor instance is rebuilt
  // on every chapter switch, eliminating the manual setContent race.
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          bulletList: { keepMarks: true, keepAttributes: false },
          orderedList: { keepMarks: true, keepAttributes: false },
        }),
        CharacterCount.configure({ limit: null }),
      ],
      content: activeChapter?.content ?? '',
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
    },
    [activeChapterId],
  );

  // When the AI stream finishes, push the resulting editor HTML back into
  // dirtyContent so the debounced save kicks in.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !aiStream.isStreaming && editor) {
      setDirtyContent(editor.getHTML());
    }
    wasStreamingRef.current = aiStream.isStreaming;
  }, [aiStream.isStreaming, editor, setDirtyContent]);

  // Stream chunks into the editor as the AI produces them.
  useEffect(() => {
    if (!editor) return;
    if (aiStream.isStreaming && aiStream.latestChunk) {
      const formattedChunk = aiStream.latestChunk.replace(/\n/g, '<br/>');
      editor
        .chain()
        .setMeta('addToHistory', false)
        .insertContent(formattedChunk)
        .scrollIntoView()
        .run();
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
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <EditorToolbar editor={editor} novelId={novelId} />
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
          <span>
            Words: {editor.storage.characterCount.words()} | Chars:{' '}
            {editor.storage.characterCount.characters()}
          </span>
        </div>
      )}
    </div>
  );
}
