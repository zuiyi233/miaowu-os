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
} from 'lucide-react';
import { useI18n } from '@/core/i18n/hooks';

interface EditorToolbarProps {
  editor: Editor | null;
  className?: string;
}

export function EditorToolbar({ editor, className }: EditorToolbarProps) {
  const { t } = useI18n();
  if (!editor) return null;

  const buttons = [
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
            title={btn.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground',
              btn.isActive && 'bg-accent text-accent-foreground'
            )}
          >
            {btn.icon}
          </button>
        )
      )}
    </div>
  );
}
