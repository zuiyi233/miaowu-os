'use client';

import { type Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  editor: Editor | null;
  className?: string;
}

export function EditorToolbar({ editor, className }: EditorToolbarProps) {
  if (!editor) return null;

  const buttons = [
    {
      label: 'Bold',
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: editor.isActive('bold'),
    },
    {
      label: 'Italic',
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: editor.isActive('italic'),
    },
    {
      label: 'Strike',
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: editor.isActive('strike'),
    },
    {
      label: 'H1',
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: editor.isActive('heading', { level: 1 }),
    },
    {
      label: 'H2',
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: editor.isActive('heading', { level: 2 }),
    },
    {
      label: 'H3',
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: editor.isActive('heading', { level: 3 }),
    },
    {
      label: 'Bullet List',
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: editor.isActive('bulletList'),
    },
    {
      label: 'Ordered List',
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: editor.isActive('orderedList'),
    },
    {
      label: 'Blockquote',
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: editor.isActive('blockquote'),
    },
    {
      label: 'Undo',
      action: () => editor.chain().focus().undo().run(),
      isActive: false,
    },
    {
      label: 'Redo',
      action: () => editor.chain().focus().redo().run(),
      isActive: false,
    },
  ];

  return (
    <div className={cn('flex flex-wrap gap-1 border-b pb-2', className)}>
      {buttons.map((btn) => (
        <button
          key={btn.label}
          onClick={btn.action}
          className={cn(
            'rounded px-2 py-1 text-sm transition-colors hover:bg-accent',
            btn.isActive && 'bg-accent font-medium'
          )}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
