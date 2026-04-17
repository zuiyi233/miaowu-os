'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Settings,
  Type,
  Palette,
  X,
  AlignVerticalSpaceAround,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getBackendBaseURL } from '@/core/config';

interface ReaderSettings {
  fontSize: number;
  theme: 'light' | 'sepia' | 'dark';
  lineHeight: number;
}

interface ChapterData {
  id: string;
  chapter_number: number;
  title: string;
  content: string;
  word_count?: number;
}

interface NavigationInfo {
  previous: { id: string; chapter_number: number; title: string } | null;
  next: { id: string; chapter_number: number; title: string } | null;
  current: { id: string; chapter_number: number; title: string };
}

interface ChapterReaderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapter: ChapterData;
  onChapterChange: (chapterId: string) => void;
}

const SETTINGS_KEY = 'chapter-reader-settings';

const defaultSettings: ReaderSettings = { fontSize: 18, theme: 'light', lineHeight: 1.8 };

function loadSettings(): ReaderSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : defaultSettings;
  } catch { return defaultSettings; }
}

function saveSettings(s: ReaderSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

const themeStyles = {
  light: { bg: '#ffffff', text: '#1a1a1a', headerBg: '#f8f9fa', border: '#e9ecef' },
  sepia: { bg: '#f4ecd8', text: '#5b4636', headerBg: '#ede0c8', border: '#d4c4a8' },
  dark: { bg: '#1a1a2e', text: '#e0e0e0', headerBg: '#16213e', border: '#2d3a5c' },
};

export function ChapterReader({ open, onOpenChange, chapter, onChapterChange }: ChapterReaderProps) {
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [navigation, setNavigation] = useState<NavigationInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { saveSettings(settings); }, [settings]);

  useEffect(() => {
    if (open && chapter?.id) {
      setLoading(true);
      fetch(`${getBackendBaseURL()}/api/chapters/${chapter.id}/navigation`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => { setNavigation(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [open, chapter?.id]);

  useEffect(() => {
    if (chapter?.id) setLoading(false);
    const el = document.querySelector('.reader-scroll-container') as HTMLElement;
    if (el) el.scrollTop = 0;
  }, [chapter?.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') navigation?.previous && onChapterChange(navigation.previous.id);
      else if (e.key === 'ArrowRight') navigation?.next && onChapterChange(navigation.next.id);
      else if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, navigation, onChapterChange, onOpenChange]);

  const update = <K extends keyof ReaderSettings>(k: K, v: ReaderSettings[K]) =>
    setSettings((p) => ({ ...p, [k]: v }));

  const t = themeStyles[settings.theme];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" style={{ background: t.bg }}>
      {/* Header */}
      <header
        className="flex-none flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 z-10"
        style={{ borderBottom: `1px solid ${t.border}`, background: t.headerBg }}
      >
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} style={{ color: t.text }}>
          <X className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">关闭</span>
        </Button>
        <h2 className={cn("text-sm sm:text-base font-semibold truncate max-w-[60%] sm:max-w-[70%]", `text-[${t.text}]`)} style={{ color: t.text }}>
          第{chapter.chapter_number}章：{chapter.title}
        </h2>
        <Button variant={showSettings ? 'default' : 'ghost'} size="sm" onClick={() => setShowSettings(!showSettings)}>
          <Settings className="w-4 h-4" />
        </Button>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="flex-none px-4 sm:px-6 py-3 space-y-4" style={{ borderBottom: `1px solid ${t.border}`, background: t.headerBg }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: t.text }}>
                <Type className="w-3.5 h-3.5" /> 字体大小: {settings.fontSize}px
              </Label>
              <Slider value={[settings.fontSize]} min={14} max={28} step={1} onValueChange={(v) => update('fontSize', v[0] ?? settings.fontSize)} />
            </div>
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: t.text }}>
                <AlignVerticalSpaceAround className="w-3.5 h-3.5" /> 行高: {settings.lineHeight.toFixed(1)}
              </Label>
              <Slider value={[settings.lineHeight * 10]} min={14} max={25} step={1} onValueChange={(v) => update('lineHeight', (v[0] ?? settings.lineHeight * 10) / 10)} />
            </div>
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: t.text }}>
                <Palette className="w-3.5 h-3.5" /> 主题
              </Label>
              <div className="flex gap-1">
                {(['light', 'sepia', 'dark'] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={settings.theme === m ? 'default' : 'outline'}
                    onClick={() => update('theme', m)}
                    className="text-xs"
                  >
                    {{ light: '日间', sepia: '护眼', dark: '夜间' }[m]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="reader-scroll-container flex-1 overflow-y-auto scroll-smooth">
        {loading ? (
          <div className="flex items-center justify-center py-20" style={{ color: t.text }}>
            <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            加载中...
          </div>
        ) : (
          <article
            className="max-w-3xl mx-auto px-4 sm:px-12 py-8 sm:py-12 min-h-full"
            style={{
              fontSize: settings.fontSize,
              lineHeight: settings.lineHeight,
              color: t.text,
              whiteSpace: 'pre-wrap',
              textAlign: 'justify',
              wordBreak: 'break-word',
            }}
          >
            {chapter.content ? (
              chapter.content.split('\n').map((para, i) =>
                para.trim() ? (
                  <p key={i} className="indent-8 mb-2">{para}</p>
                ) : <br key={i} />
              )
            ) : (
              <p className="text-center py-20 opacity-50">暂无内容</p>
            )}
          </article>
        )}
      </div>

      {/* Footer Navigation */}
      <footer
        className="flex-none flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 z-10"
        style={{ borderTop: `1px solid ${t.border}`, background: t.headerBg }}
      >
        <Button onClick={() => navigation?.previous && onChapterChange(navigation.previous.id)} disabled={!navigation?.previous || loading}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">上一章</span>
        </Button>

        <div className="text-center" style={{ color: t.text }}>
          <p className="text-sm">{chapter.word_count || 0} 字</p>
          <p className="text-xs opacity-60 hidden sm:block">
            {navigation?.previous ? `← ${navigation.previous.title}` : '已是第一章'}{' | '}
            {navigation?.next ? `${navigation.next.title} →` : '已是最后一章'}
          </p>
        </div>

        <Button onClick={() => navigation?.next && onChapterChange(navigation.next.id)} disabled={!navigation?.next || loading}>
          <span className="hidden sm:inline">下一章</span>
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </footer>
    </div>
  );
}
