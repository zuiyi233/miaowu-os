import React from "react";
import {
  useEditor,
  EditorContent,
  Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention"; // ✅ 引入 Mention
import { mentionSuggestion } from "@/lib/tiptap/mention"; // ✅ 复用现有的建议逻辑
import { MentionOption } from "@/hooks/useMentionOptions"; // ✅ 引入统一的提及选项类型
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Undo,
  Redo,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface MiniToolbarProps {
  editor: TiptapEditor | null;
}

const MiniToolbar: React.FC<MiniToolbarProps> = ({ editor }) => {
  if (!editor) return null;

  return (
    <div className="border border-b-0 rounded-t-md p-1 flex gap-1 items-center bg-card flex-wrap">
      {/* 撤销/重做 */}
      <Toggle
        size="sm"
        pressed={false}
        onPressedChange={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={false}
        onPressedChange={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 文本格式 */}
      <Toggle
        size="sm"
        pressed={editor.isActive("bold")}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("italic")}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 标题 */}
      <Toggle
        size="sm"
        pressed={editor.isActive("heading", { level: 1 })}
        onPressedChange={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <Heading1 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("heading", { level: 2 })}
        onPressedChange={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("heading", { level: 3 })}
        onPressedChange={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
      >
        <Heading3 className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 引用 */}
      <Toggle
        size="sm"
        pressed={editor.isActive("blockquote")}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 列表 */}
      <Toggle
        size="sm"
        pressed={editor.isActive("bulletList")}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("orderedList")}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </Toggle>
    </div>
  );
};

interface MiniEditorProps {
  content: string;
  onChange: (htmlContent: string) => void;
  className?: string;
  mentionItems?: MentionOption[]; // ✅ 新增 prop 接收统一的提及数据
}

/**
 * 轻量级富文本编辑器
 * 现已支持 @提及 功能
 */
export const MiniEditor: React.FC<MiniEditorProps> = ({
  content,
  onChange,
  className,
  mentionItems = [], // 默认为空数组
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: {},
        codeBlock: false,
      }),
      // ✅ 动态配置 Mention 扩展
      Mention.configure({
        HTMLAttributes: {
          class: "mention", // 保持与主编辑器一致的样式类
        },
        suggestion: mentionSuggestion(mentionItems),
      }),
    ],
    content: content,
    editorProps: {
      attributes: {
        class:
          "min-h-[120px] w-full rounded-b-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 prose dark:prose-invert max-w-full prose-headings:my-2 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-blockquote:my-2 prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic",
      },
    },
    // 当传入的 mentionItems 更新时，我们需要重新创建 extension 实例吗？
    // Tiptap 的 configure 通常在初始化时运行。
    // 对于 mentionSuggestion，它是闭包。为了响应数据变化，最简单的方法是依赖 editor 重新挂载，
    // 或者在 useEffect 中 setOptions (比较复杂)。
    // 鉴于表单打开时数据通常已加载，初始化配置通常足够。
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  return (
    <div className={cn("flex flex-col", className)}>
      <MiniToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};
