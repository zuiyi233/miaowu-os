'use client';

import { ArrowLeft, ArrowRight, BookOpen, Settings, Eye, Sun, Type, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useSettingsStore } from '@/core/novel';
import { useNovelStore } from '@/core/novel';

const READING_THEMES = {
  light: { bg: '#ffffff', text: '#1a1a1a', accent: '#3b82f6', secondary: '#6b7280' },
  sepia: { bg: '#f5e6d3', text: '#4a3728', accent: '#8b5e3c', secondary: '#7a6455' },
  dark: { bg: '#1a1a2e', text: '#e0e0e0', accent: '#60a5fa', secondary: '#9ca3af' },
  forest: { bg: '#1a2e1a', text: '#c8d8c8', accent: '#4ade80', secondary: '#86efac' },
};

type ReadingTheme = keyof typeof READING_THEMES;

interface ReadingModeProps {
  novelId: string;
  chapters: Array<{ id: string; title: string; content?: string; order: number }>;
  initialChapterIndex?: number;
  onExit?: () => void;
}

export function ReadingMode({ novelId: _novelId, chapters, initialChapterIndex = 0, onExit }: ReadingModeProps) {
  const [currentChapterIndex, setCurrentChapterIndex] = useState(initialChapterIndex);
  const [showSettings, setShowSettings] = useState(false);
  const isImmersive = useNovelStore((state) => state.isImmersive);
  const settingsStore = useSettingsStore();
  const settingsCompat =
    (settingsStore as unknown as { settings?: Record<string, unknown> }).settings || settingsStore;
  const updateSettings = settingsStore.updateSettings;

  const [theme, setTheme] = useState<ReadingTheme>((settingsCompat.readingTheme as ReadingTheme) || 'light');
  const [fontSize, setFontSize] = useState((settingsCompat.readingFontSize as number) || 18);
  const [lineHeight, setLineHeight] = useState((settingsCompat.readingLineHeight as number) || 1.8);
  const [paragraphSpacing, setParagraphSpacing] = useState((settingsCompat.readingParagraphSpacing as number) || 16);
  const [focusMode, setFocusMode] = useState(false);
  const [isPinned] = useState(false);

  const themeColors = READING_THEMES[theme];
  const currentChapter = chapters[currentChapterIndex];

  const paragraphs = useMemo(() => {
    if (!currentChapter?.content) return [];
    const html = currentChapter.content.replace(/<[^>]*>/g, '').trim();
    return html.split(/\n+/).filter((p) => p.trim());
  }, [currentChapter?.content]);

  const goToChapter = useCallback(
    (index: number) => {
      if (index >= 0 && index < chapters.length) {
        setCurrentChapterIndex(index);
      }
    },
    [chapters.length]
  );

  const goToPrev = useCallback(() => goToChapter(currentChapterIndex - 1), [currentChapterIndex, goToChapter]);
  const goToNext = useCallback(() => goToChapter(currentChapterIndex + 1), [currentChapterIndex, goToChapter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          goToPrev();
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
          goToNext();
          e.preventDefault();
          break;
        case 'Escape':
          if (!isPinned) onExit?.();
          break;
        case 'f':
          setFocusMode((prev) => !prev);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrev, goToNext, onExit, isPinned]);

  const applyTheme = useCallback(() => {
    updateSettings({
      readingTheme: theme,
      readingFontSize: fontSize,
      readingLineHeight: lineHeight,
      readingParagraphSpacing: paragraphSpacing,
    });
  }, [theme, fontSize, lineHeight, paragraphSpacing, updateSettings]);

  const progress = chapters.length > 0 ? ((currentChapterIndex + 1) / chapters.length) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ backgroundColor: themeColors.bg, color: themeColors.text }}
    >
      {/* Progress bar */}
      <div className="h-0.5 w-full" style={{ backgroundColor: `${themeColors.accent}20` }}>
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            backgroundColor: themeColors.accent,
          }}
        />
      </div>

      {/* Top toolbar */}
      {!isImmersive && (
        <header
          className="flex items-center justify-between border-b px-4 py-2"
          style={{ borderColor: `${themeColors.accent}30`, backgroundColor: `${themeColors.bg}f0` }}
        >
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onExit}>
              <X className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" style={{ color: themeColors.accent }} />
              <span className="text-sm font-medium truncate max-w-[200px]">{currentChapter?.title}</span>
              <Badge variant="outline" style={{ borderColor: themeColors.accent, color: themeColors.accent }}>
                {currentChapterIndex + 1} / {chapters.length}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFocusMode(!focusMode)}
              title="焦点模式 (F)"
              style={focusMode ? { backgroundColor: `${themeColors.accent}20` } : undefined}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Settings panel */}
        {showSettings && (
          <aside
            className="w-72 overflow-y-auto border-r p-4"
            style={{ borderColor: `${themeColors.accent}30`, backgroundColor: `${themeColors.bg}` }}
          >
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Sun className="h-4 w-4" /> 主题
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.keys(READING_THEMES) as ReadingTheme[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className="h-8 rounded-md border-2 transition-all"
                      style={{
                        backgroundColor: READING_THEMES[t].bg,
                        borderColor: theme === t ? READING_THEMES[t].accent : 'transparent',
                      }}
                      title={t}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Type className="h-4 w-4" /> 字号
                </label>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setFontSize((v) => Math.max(12, v - 1))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Slider
                    value={[fontSize]}
                    onValueChange={([v]) => {
                      if (v !== undefined) {
                        setFontSize(v);
                      }
                    }}
                    min={12}
                    max={32}
                    step={1}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setFontSize((v) => Math.min(32, v + 1))}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="text-sm w-8 text-right">{fontSize}</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">行高</label>
                <Slider
                  value={[lineHeight]}
                  onValueChange={([v]) => {
                    if (v !== undefined) {
                      setLineHeight(v);
                    }
                  }}
                  min={1.2}
                  max={2.5}
                  step={0.1}
                />
                <span className="text-xs mt-1 block">{lineHeight.toFixed(1)}</span>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">段落间距</label>
                <Slider
                  value={[paragraphSpacing]}
                  onValueChange={([v]) => {
                    if (v !== undefined) {
                      setParagraphSpacing(v);
                    }
                  }}
                  min={0}
                  max={40}
                  step={2}
                />
                <span className="text-xs mt-1 block">{paragraphSpacing}px</span>
              </div>

              <Button className="w-full" onClick={applyTheme} style={{ backgroundColor: themeColors.accent }}>
                应用设置
              </Button>
            </div>
          </aside>
        )}

        {/* Reading content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{
            padding: focusMode ? '2rem' : '3rem 4rem',
            maxWidth: focusMode ? '100%' : '800px',
            margin: focusMode ? undefined : '0 auto',
          }}
        >
          <article>
            <h1
              className="mb-8 font-bold"
              style={{
                fontSize: `${fontSize * 1.5}px`,
                lineHeight: 1.3,
                color: themeColors.accent,
              }}
            >
              {currentChapter?.title}
            </h1>

            <div
              className="reading-content"
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${lineHeight}`,
                letterSpacing: '0.02em',
              }}
            >
              {paragraphs.length > 0 ? (
                paragraphs.map((p, i) => (
                  <p
                    key={i}
                    style={{
                      marginBottom: `${paragraphSpacing}px`,
                      textIndent: '2em',
                      opacity: focusMode ? (i === 0 ? 1 : 0.3) : 1,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    {p}
                  </p>
                ))
              ) : (
                <p style={{ color: themeColors.secondary }}>暂无内容</p>
              )}
            </div>
          </article>
        </main>

        {/* Chapter list sidebar */}
        {!isImmersive && chapters.length > 5 && (
          <aside
            className="w-64 overflow-y-auto border-l"
            style={{ borderColor: `${themeColors.accent}30` }}
          >
            <div className="p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: themeColors.secondary }}>
                目录
              </h3>
              <div className="space-y-1">
                {chapters.map((ch, i) => (
                  <button
                    key={ch.id}
                    onClick={() => goToChapter(i)}
                    className={`w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors truncate ${
                      i === currentChapterIndex ? 'font-medium' : 'hover:opacity-70'
                    }`}
                    style={{
                      backgroundColor: i === currentChapterIndex ? `${themeColors.accent}20` : 'transparent',
                      color: i === currentChapterIndex ? themeColors.accent : themeColors.text,
                    }}
                  >
                    {ch.title}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom navigation */}
      {!isImmersive && (
        <footer
          className="flex items-center justify-between border-t px-4 py-2"
          style={{ borderColor: `${themeColors.accent}30` }}
        >
          <Button variant="ghost" size="sm" onClick={goToPrev} disabled={currentChapterIndex === 0}>
            <ArrowLeft className="mr-1 h-3 w-3" /> 上一章
          </Button>
          <span className="text-xs" style={{ color: themeColors.secondary }}>
            {Math.round(progress)}% 已完成
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNext}
            disabled={currentChapterIndex >= chapters.length - 1}
          >
            下一章 <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </footer>
      )}
    </div>
  );
}
