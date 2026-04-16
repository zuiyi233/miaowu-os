'use client';

import { type Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Wand2, BookOpen, PenTool } from 'lucide-react';
import { useAiPanelStore } from '@/core/novel';

interface AiActionToolbarProps {
  editor: Editor;
}

export function AiActionToolbar({ editor }: AiActionToolbarProps) {
  const { startStreaming, setSelectedText } = useAiPanelStore();
  const selectedText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    ' '
  );

  if (!selectedText) return null;

  const handleContinue = async () => {
    setSelectedText(selectedText);
    startStreaming();
  };

  const handlePolish = async () => {
    setSelectedText(selectedText);
    startStreaming();
  };

  const handleExpand = async () => {
    setSelectedText(selectedText);
    startStreaming();
  };

  return (
    <div className="flex items-center gap-1 p-1">
      <Button variant="ghost" size="sm" onClick={handleContinue} className="h-7 gap-1 px-2 text-xs">
        <BookOpen className="h-3 w-3" />
        Continue
      </Button>
      <Button variant="ghost" size="sm" onClick={handlePolish} className="h-7 gap-1 px-2 text-xs">
        <PenTool className="h-3 w-3" />
        Polish
      </Button>
      <Button variant="ghost" size="sm" onClick={handleExpand} className="h-7 gap-1 px-2 text-xs">
        <Wand2 className="h-3 w-3" />
        Expand
      </Button>
    </div>
  );
}
