import React, { useEffect, useState, useRef } from "react";
import {
  useEditor,
  EditorContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CharacterCount from "@tiptap/extension-character-count";
import Mention from "@tiptap/extension-mention";
import { useUiStore } from "../stores/useUiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useContextStore } from "../stores/useContextStore";
import {
  useNovelQuery,
  useUpdateChapterMutation,
} from "../lib/react-query/db-queries";
import { useContinueWritingMutation } from "../lib/react-query/queries";
import { EditorToolbar } from "./EditorToolbar";
import { ChapterInfoCard } from "./editor/ChapterInfoCard";
import { mentionSuggestion } from "../lib/tiptap/mention";
import { useMentionOptions } from "../hooks/useMentionOptions";
import { User, MapPin, Shield, Gem } from "lucide-react";
import { SlashCommand } from "../lib/tiptap/slash-command";
import { useDebouncedCallback } from "../hooks/useDebounce";
import { LoadingOverlay } from "./common/LoadingOverlay";

export const Editor: React.FC = () => {
  const {
    activeChapterId,
    dirtyContent,
    setDirtyContent,
    // ✅ 获取 AI 流状态
    aiStream,
  } = useUiStore();

  // ✅ 获取 markDirty - 使用 selector 确保轻量化
  const markDirty = useContextStore((state) => state.markDirty);

  // ✅ 从设置 store 获取自动保存的配置 - 使用单独的selector避免无限重新渲染
  const autoSaveEnabled = useSettingsStore((state) => state.autoSaveEnabled);
  const autoSaveDelay = useSettingsStore((state) => state.autoSaveDelay);

  // 使用整合的React Query获取数据 - 性能优化：单次查询获取所有数据
  const { data: novelData, isLoading } = useNovelQuery();
  const updateChapterMutation = useUpdateChapterMutation();

  // 获取续写 mutation
  const continueWritingMutation = useContinueWritingMutation();

  // 从完整的小说数据中解构所需的数据
  const { chapters = [], characters = [] } = novelData || {};
  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  // ✅ 步骤 1: 创建一个 Ref 来存储上一个章节 ID 和脏内容
  const previousChapterRef = useRef<{ id: string; content: string | null }>({
    id: "",
    content: null,
  });

  // ✅ 步骤 2: 更新 Ref。这个 effect 会在每次渲染后运行，确保我们总是有最新的脏内容引用
  useEffect(() => {
    previousChapterRef.current = {
      id: activeChapterId,
      content: dirtyContent,
    };
  });

  // 防抖保存函数 - 保存脏内容到数据库
  // ✅ 将 store 中的延迟传递给 useDebouncedCallback
  const debouncedSave = useDebouncedCallback((content: string) => {
    if (activeChapterId && autoSaveEnabled) {
      // ✅ 检查开关状态
      updateChapterMutation.mutate({
        chapterId: activeChapterId,
        content,
      });
      // 保存后清除脏状态
      setDirtyContent(null);
    }
  }, autoSaveDelay); // ✅ 使用可配置的延迟

  // 监听脏内容变化并触发防抖保存
  useEffect(() => {
    if (dirtyContent !== null) {
      debouncedSave(dirtyContent);
    }
  }, [dirtyContent, debouncedSave]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      // 添加字数统计功能
      CharacterCount.configure({
        limit: null, // 不限制字数
      }),
      // 配置统一提及功能
      Mention.configure({
        HTMLAttributes: {
          class: "mention", // 为提及添加样式类
        },
        suggestion: mentionSuggestion(useMentionOptions()),
      }),
      // 配置斜杠命令功能
      SlashCommand.configure({
        continueWritingMutation: continueWritingMutation, // 传入真实的 mutation
        activeChapterId: activeChapterId, // 传入当前章节ID
      }),
    ],
    content: activeChapter?.content || "",
    editorProps: {
      attributes: {
        // ✅ 关键：确保 Tailwind Typography 类名包含列表和引用的样式
        // prose-ul, prose-ol, prose-blockquote 默认包含在 prose 中，但有时需要显式调整
        class:
          'prose dark:prose-invert prose-lg focus:outline-none w-full font-["Lora"] leading-relaxed max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic prose-ul:list-disc prose-ol:list-decimal',
      },
    },
    onUpdate: ({ editor }) => {
      // 仅在非 AI 流式传输时触发常规脏检查
      // 如果正在流式传输，我们在流结束时统一触发
      if (!aiStream.isStreaming) {
        setDirtyContent(editor.getHTML());
        markDirty();
      }
    },
  });

  // ✅ 步骤 3: 创建一个新的、专门用于处理章节切换时保存逻辑的 useEffect
  useEffect(() => {
    // 这个 effect 只在 activeChapterId 变化时运行
    const previousChapter = previousChapterRef.current;

    // 如果存在上一个章节的信息，并且有未保存的脏内容
    if (previousChapter && previousChapter.content !== null) {
      // 立即保存上一个章节的脏数据
      debouncedSave.cancel(); // 取消可能正在进行的防抖
      updateChapterMutation.mutate(
        {
          chapterId: previousChapter.id,
          content: previousChapter.content,
        },
        {
          onSuccess: () => {
            // 保存成功后才清除脏状态，这里可以省略，因为 setDirtyContent(null) 很快会发生
          },
        }
      );
      // 立即清除脏状态，为新章节做准备
      setDirtyContent(null);
    }

    // 章节切换后，用新章节的内容更新编辑器
    if (editor) {
      const newContent =
        chapters.find((ch) => ch.id === activeChapterId)?.content || "";
      if (editor.getHTML() !== newContent) {
        editor.commands.setContent(newContent, { emitUpdate: false });
      }
    }
  }, [activeChapterId, editor]); // <--- 关键：依赖项只有 activeChapterId 和 editor

  // ❌ 删除或注释掉原来的、有问题的 useEffect
  /*
  useEffect(() => {
    if (editor) {
      // 核心逻辑：切换前，检查并强制保存上一章的脏数据
      if (dirtyContent !== null && activeChapterId) {
        // 取消任何正在进行的防抖保存
        debouncedSave.cancel();
        // 立即同步保存
        updateChapterMutation.mutate({
          chapterId: activeChapterId,
          content: dirtyContent,
        });
        setDirtyContent(null);
      }

      // 更新编辑器内容
      const newContent = activeChapter?.content || "";
      if (editor.getHTML() !== newContent) {
        editor.commands.setContent(newContent, { emitUpdate: false });
      }
    }
  }, [
    activeChapter,
    editor,
    activeChapterId,
    dirtyContent, // <--- 问题的根源
    debouncedSave,
    updateChapterMutation,
    setDirtyContent,
  ]);
  */

  // ✅ 移除：不再需要监听跳转到细纲的事件，因为细纲现在是独立组件
  // 保留这个注释作为历史记录，说明我们已经重构了细纲的实现方式

  // ✅ 核心重构：监听 AI 流式状态 (替代 Event Listeners)
  useEffect(() => {
    if (!editor) return;

    // 1. 开始：如果刚开始流式传输，确保编辑器获得焦点
    if (aiStream.isStreaming && aiStream.seq === 0) {
      if (!editor.isFocused) {
        editor.commands.focus("end");
      }
    }

    // 2. 过程：如果有新的 chunk，插入编辑器
    if (aiStream.isStreaming && aiStream.latestChunk) {
      const formattedChunk = aiStream.latestChunk.replace(/\n/g, "<br/>");

      // ✅ 修复：插入时不添加到历史堆栈 (addToHistory: false)
      editor
        .chain()
        .setMeta("addToHistory", false) // 关键：防止撤销栈爆炸
        .insertContent(formattedChunk)
        .scrollIntoView()
        .run();
    }

    // 3. 结束：检测流是否刚结束 (从 true 变为 false)
    // 注意：useEffect 依赖 aiStream.isStreaming。
    // 当它变为 false 时，我们需要做一次清理/保存。
    // 但这里有一个闭包陷阱：在 false 的这一刻，我们如何知道"刚才"是 true？
    // 简单的做法是：在 onUpdate 中我们跳过了 setDirtyContent，
    // 所以我们需要一个单独的 Effect 或者 ref 来追踪上一帧的状态。
  }, [aiStream.seq, aiStream.isStreaming, aiStream.latestChunk, editor]);

  // ✅ 补充 Effect：专门处理流结束时的保存
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !aiStream.isStreaming) {
      // 流刚刚结束
      if (editor) {
        // 触发保存
        const html = editor.getHTML();
        setDirtyContent(html);
        markDirty();
      }
    }
    wasStreamingRef.current = aiStream.isStreaming;
  }, [aiStream.isStreaming, editor, setDirtyContent, markDirty]);

  // ✅ 新增：监听大纲跳转事件
  useEffect(() => {
    const handleScrollToOutline = (event: CustomEvent) => {
      const { chapterId } = event.detail;
      // 只有当目标章节是当前激活章节时才滚动
      if (chapterId === activeChapterId) {
        // 查找 ChapterInfoCard 的 DOM 元素
        const infoCard = document.querySelector(
          `[data-chapter-id="${chapterId}"]`
        );
        if (infoCard) {
          infoCard.scrollIntoView({ behavior: "smooth", block: "start" });
          // 可选：高亮一下
          infoCard.classList.add("ring-2", "ring-primary");
          setTimeout(
            () => infoCard.classList.remove("ring-2", "ring-primary"),
            2000
          );
        }
      }
    };

    window.addEventListener(
      "editor-scroll-to-outline" as any,
      handleScrollToOutline
    );
    return () => {
      window.removeEventListener(
        "editor-scroll-to-outline" as any,
        handleScrollToOutline
      );
    };
  }, [activeChapterId]);

  // 如果正在加载，显示加载状态
  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-background relative overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">正在加载数据...</div>
        </div>
      </div>
    );
  }

  // 如果没有小说数据，显示错误状态
  if (!novelData) {
    return (
      <div className="h-full flex flex-col bg-background relative overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">未找到小说数据</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background relative overflow-hidden">
      <div className="flex-1 w-full flex justify-center overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold font-['Lora'] mb-6 tracking-tight">
            {activeChapter?.title}
          </h1>

          {/* ✅ 新增：独立的细纲/目标展示区 */}
          {activeChapter && <ChapterInfoCard chapter={activeChapter} />}

          <EditorToolbar editor={editor} className="mb-8" />
          <EditorContent editor={editor} />
        </div>
      </div>
      {/* 使用 store 中的状态控制 loading */}
      {aiStream.isStreaming && (
        <LoadingOverlay
          title="AI 正在写作..."
          description="请稍候，AI 正在为您创作精彩内容"
        />
      )}

      {/* 字数统计显示 */}
      {editor && (
        <div className="border-t p-2 text-sm text-muted-foreground text-right">
          字数: {editor.storage.characterCount.words()} | 字符:{" "}
          {editor.storage.characterCount.characters()}
        </div>
      )}
    </div>
  );
};
