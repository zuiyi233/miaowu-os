'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React from 'react';

import type { OutlineNode } from '@/core/novel/schemas';

interface SortableOutlineItemProps {
  id: string;
  node: OutlineNode;
  children: React.ReactNode;
}

export const SortableOutlineItem: React.FC<SortableOutlineItemProps> = ({ id, node: _node, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};
