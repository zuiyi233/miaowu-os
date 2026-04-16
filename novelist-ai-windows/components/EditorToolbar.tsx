import React from "react";
import type { Editor } from "@tiptap/react";
import { Toggle } from "./ui/toggle";
import { Separator } from "./ui/separator"; // ✅ 引入分隔线
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Strikethrough // 可选：增加删除线
} from "lucide-react";
import { cn } from "../lib/utils";
import { HistorySheet } from "./HistorySheet";
import { useNovelQuery } from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";

interface EditorToolbarProps {
  editor: Editor | null;
  className?: string;
}

/**
 * 编辑器工具栏组件 (升级版)
 * 功能对齐 MiniEditor，提供完整的富文本操作能力
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  className,
}) => {
  const { data: novel } = useNovelQuery();
  const { activeChapterId } = useUiStore();
  const activeChapter = novel?.chapters?.find(
    (ch) => ch.id === activeChapterId
  );

  if (!editor) return null;

  return (
    <div
      className={cn(
        "border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 rounded-lg shadow-sm p-1.5 flex gap-1 items-center flex-wrap sticky top-2 z-40 mx-auto max-w-fit",
        className
      )}
    >
      {/* 组 1: 历史操作 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          aria-label="Undo"
          title="撤销 (Ctrl+Z)"
        >
          <Undo className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          aria-label="Redo"
          title="重做 (Ctrl+Y)"
        >
          <Redo className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 2: 基础格式 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          title="加粗 (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          title="斜体 (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("strike")}
          onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
          title="删除线"
        >
          <Strikethrough className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 3: 标题 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 1 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          aria-label="H1"
          title="一级标题"
        >
          <Heading1 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 2 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          aria-label="H2"
          title="二级标题"
        >
          <Heading2 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 3 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          aria-label="H3"
          title="三级标题"
        >
          <Heading3 className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 4: 列表与引用 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("bulletList")}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Bullet List"
          title="无序列表"
        >
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("orderedList")}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Ordered List"
          title="有序列表"
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("blockquote")}
          onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label="Blockquote"
          title="引用段落"
        >
          <Quote className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 5: 高级功能 (历史记录) */}
      {activeChapter && (
        <div className="ml-1">
          <HistorySheet
            chapterId={activeChapter.id}
            chapterTitle={activeChapter.title}
          />
        </div>
      )}
    </div>
  );
};
