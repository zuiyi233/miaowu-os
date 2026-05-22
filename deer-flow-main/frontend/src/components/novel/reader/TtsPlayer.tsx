'use client';

import { Volume2, VolumeX, Pause, Square, ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/core/i18n/hooks';
import { useTts, type TtsProvider } from '@/core/tts';

type ExternalTts = ReturnType<typeof useTts>;

interface TtsPlayerProps {
  text: string;
  theme?: { text: string; border: string; headerBg: string };
  compact?: boolean;
  className?: string;
  tts?: ExternalTts;
}

export function TtsPlayer({ text, theme, compact = false, className, tts: externalTts }: TtsPlayerProps) {
  const internalTts = useTts();
  const tts = externalTts ?? internalTts;
  const { t } = useI18n();
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevTextRef = useRef(text);

  useEffect(() => {
    if (prevTextRef.current !== text && tts.playing) {
      tts.stop();
    }
    prevTextRef.current = text;
  }, [text, tts]);

  useEffect(() => {
    if (tts.error) {
      setDismissedError(null);
    }
  }, [tts.error]);

  useEffect(() => {
    if (!showVoicePanel) return;
    const handler = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowVoicePanel(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showVoicePanel]);

  const handleSpeak = useCallback(() => {
    if (tts.playing) {
      tts.pause();
    } else if (tts.currentTime > 0 && !tts.loading) {
      tts.resume();
    } else {
      tts.speak(text);
    }
  }, [tts.playing, tts.loading, tts.currentTime, tts.pause, tts.resume, tts.speak, text]);

  const handleStop = useCallback(() => {
    tts.stop();
  }, [tts.stop]);

  const handleSeek = useCallback(
    (value: number[]) => {
      const fraction = (value[0] ?? 0) / 100;
      tts.seek(fraction);
    },
    [tts.seek],
  );

  const handleDismissError = useCallback(() => {
    setDismissedError(tts.error);
    tts.clearError();
  }, [tts]);

  const hasContent = text.trim().length > 0;
  const textColor = theme?.text ?? 'inherit';
  const availableProviders = tts.config
    ? (Object.entries(tts.config.providers) as [TtsProvider, { available: boolean }][])
        .filter(([, v]) => v.available)
        .map(([k]) => k)
    : [];
  const noProviderAvailable = tts.config !== null && availableProviders.length === 0;
  const visibleError = tts.error && tts.error !== dismissedError ? tts.error : null;
  const visibleErrorText = useMemo(() => {
    if (!visibleError) return null;
    switch (tts.errorCode) {
      case 'playback':
        return t.novel.ttsErrorPlayback;
      case 'synthesis':
        return t.novel.ttsErrorSynthesis;
      case 'autoplay_blocked':
        return t.novel.ttsErrorAutoplayBlocked;
      case 'load_config':
        return t.novel.ttsErrorLoadConfig;
      case 'load_voices':
        return t.novel.ttsErrorLoadVoices;
      default:
        return visibleError;
    }
  }, [visibleError, t.novel, tts.errorCode]);

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`} ref={panelRef}>
      {noProviderAvailable ? (
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          disabled
          title={t.novel.ttsUnavailable}
          aria-label={t.novel.ttsUnavailableShort}
          style={{ color: textColor, opacity: 0.4 }}
        >
          <VolumeX className="w-4 h-4" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          onClick={handleSpeak}
          disabled={!hasContent || tts.loading}
          title={tts.playing ? t.novel.ttsPause : t.novel.ttsPlay}
          aria-label={tts.playing ? t.novel.ttsPause : tts.loading ? t.novel.ttsGenerating : t.novel.ttsPlay}
          style={{ color: textColor }}
        >
          {tts.loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : tts.playing ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </Button>
      )}

      {tts.playing && (
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          onClick={handleStop}
          title={t.novel.ttsStop}
          aria-label={t.novel.ttsStop}
          style={{ color: textColor }}
        >
          <Square className="w-3.5 h-3.5" />
        </Button>
      )}

      {(tts.playing || tts.currentTime > 0) && !compact && (
        <div className="flex items-center gap-1.5 min-w-[120px] max-w-[200px]" role="slider" aria-label={t.novel.ttsProgress} aria-valuenow={Math.round(tts.progress)} aria-valuemin={0} aria-valuemax={100}>
          <Slider
            value={[tts.progress]}
            min={0}
            max={100}
            step={0.5}
            onValueChange={handleSeek}
            className="flex-1"
          />
          <span className="text-[10px] tabular-nums whitespace-nowrap" style={{ color: textColor, opacity: 0.7 }}>
            {formatTime(tts.currentTime)}
          </span>
        </div>
      )}

      <div className="relative">
        <Button
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          onClick={() => setShowVoicePanel(!showVoicePanel)}
          title={t.novel.ttsSettings}
          aria-label={t.novel.ttsSettings}
          aria-expanded={showVoicePanel}
          style={{ color: textColor }}
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showVoicePanel ? 'rotate-180' : ''}`} />
        </Button>

        {showVoicePanel && (
          <div
            className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover p-3 shadow-lg"
            role="dialog"
            aria-label={t.novel.ttsSettingsPanel}
            style={theme ? { background: theme.headerBg, borderColor: theme.border } : undefined}
          >
            {noProviderAvailable && (
              <p className="text-xs text-muted-foreground mb-2">
                {t.novel.ttsConfigHint}
              </p>
            )}

            {availableProviders.length > 1 && (
              <div className="mb-2">
                <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                  {t.novel.ttsProvider}
                </label>
                <div className="flex gap-1" role="radiogroup" aria-label={t.novel.ttsChooseProvider}>
                  {availableProviders.map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={tts.selectedProvider === p ? 'default' : 'outline'}
                      onClick={() => tts.setSelectedProvider(p)}
                      className="text-xs flex-1"
                      role="radio"
                      aria-checked={tts.selectedProvider === p}
                    >
                      {p === 'openai' ? t.novel.ttsProviderOpenAI : t.novel.ttsProviderVolcengine}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {tts.voices.length > 0 && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                  {t.novel.ttsVoice}
                </label>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t.novel.ttsChooseVoice}>
                  {tts.voices.map((v) => (
                    <Button
                      key={v.id}
                      size="sm"
                      variant={tts.selectedVoice === v.id ? 'default' : 'outline'}
                      onClick={() => tts.setSelectedVoice(v.id)}
                      className="text-xs"
                      role="radio"
                      aria-checked={tts.selectedVoice === v.id}
                    >
                      {v.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {visibleError && (
              <div className="mt-2 flex items-start gap-1.5">
                <p className="text-xs text-destructive flex-1">{visibleErrorText}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismissError}
                  className="text-xs shrink-0 h-auto p-0.5"
                  aria-label={t.novel.ttsCloseError}
                >
                  ×
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
