'use client';

import { type Editor } from '@tiptap/react';
import { BookOpen, PenTool, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/core/i18n/hooks';
import { useAiPanelStore } from '@/core/novel';

interface AiActionToolbarProps {
  editor: Editor;
}

export function AiActionToolbar({ editor }: AiActionToolbarProps) {
  const { t } = useI18n();
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
    <div className="absolute bottom-12 left-1/2 z-40 -translate-x-1/2 rounded-full border bg-popover px-2 py-1 shadow-lg">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={handleContinue} className="h-8 gap-1 px-3 text-xs">
          <BookOpen className="h-3.5 w-3.5" />
          {t.novel.continue}
        </Button>
        <Button variant="ghost" size="sm" onClick={handlePolish} className="h-8 gap-1 px-3 text-xs">
          <PenTool className="h-3.5 w-3.5" />
          {t.novel.polish}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExpand} className="h-8 gap-1 px-3 text-xs">
          <Sparkles className="h-3.5 w-3.5" />
          {t.novel.expandScene}
        </Button>
      </div>
    </div>
  );
}
