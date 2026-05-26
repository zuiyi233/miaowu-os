'use client';

import { Ban, Download, Loader2, Pause, RefreshCw, RotateCcw, Square, Volume2, VolumeX, ChevronDown, Smartphone, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/core/i18n/hooks';
import { useTts, type TtsNarrationMode, type TtsProvider } from '@/core/tts';

type ExternalTts = ReturnType<typeof useTts>;
type TtsProviderAvailability = { available: boolean };
type TtsCapabilityMap = {
  advanced_features?: Record<string, unknown>;
  [key: string]: unknown;
};

interface TtsPlayerProps {
  text: string;
  chapterId?: string;
  projectId?: string;
  title?: string;
  theme?: { text: string; border: string; headerBg: string };
  compact?: boolean;
  className?: string;
  tts?: ExternalTts;
}

export function TtsPlayer({ text, chapterId, projectId, title, theme, compact = false, className, tts: externalTts }: TtsPlayerProps) {
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
  }, [text, tts.playing, tts.stop]);

  useEffect(() => {
    return () => {
      if (tts.playing) {
        tts.stop();
      }
    };
  }, [tts.playing, tts.stop]);

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

  useEffect(() => {
    if (!chapterId || !showVoicePanel) return;
    void tts.loadChapterAudio(chapterId, { project_id: projectId });
    void tts.loadNarrationPlan(chapterId, { project_id: projectId });
  }, [
    chapterId,
    projectId,
    showVoicePanel,
    tts.loadChapterAudio,
    tts.loadNarrationPlan,
    tts.selectedProvider,
    tts.selectedVoice,
    tts.selectedModel,
    tts.selectedFormat,
    tts.selectedSpeed,
    tts.instructions,
  ]);

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

  const handleGenerateChapter = useCallback(() => {
    if (!chapterId) return;
    if (tts.narrationMode === 'ai_multivoice' && !tts.narrationPlan?.plan_id) return;
    void tts.generateChapter(chapterId, text, {
      project_id: projectId,
      title,
      force: false,
      mode: tts.narrationMode,
      plan_id: tts.narrationMode === 'ai_multivoice' ? tts.narrationPlan?.plan_id ?? undefined : undefined,
      speaker_voices: tts.narrationMode === 'ai_multivoice' ? tts.speakerVoices : undefined,
    });
  }, [chapterId, projectId, text, title, tts]);

  const handleForceGenerateChapter = useCallback(() => {
    if (!chapterId) return;
    if (tts.narrationMode === 'ai_multivoice' && !tts.narrationPlan?.plan_id) return;
    void tts.generateChapter(chapterId, text, {
      project_id: projectId,
      title,
      force: true,
      mode: tts.narrationMode,
      plan_id: tts.narrationMode === 'ai_multivoice' ? tts.narrationPlan?.plan_id ?? undefined : undefined,
      speaker_voices: tts.narrationMode === 'ai_multivoice' ? tts.speakerVoices : undefined,
    });
  }, [chapterId, projectId, text, title, tts]);

  const handleDownload = useCallback(() => {
    if (!tts.downloadUrl) return;
    window.open(tts.downloadUrl, '_blank', 'noopener,noreferrer');
  }, [tts.downloadUrl]);

  const handleNarrationModeChange = useCallback((mode: TtsNarrationMode) => {
    tts.setNarrationMode(mode);
  }, [tts]);

  const handleLoadNarrationPlan = useCallback(() => {
    if (!chapterId) return;
    void tts.loadNarrationPlan(chapterId, { project_id: projectId });
  }, [chapterId, projectId, tts]);

  const handleGenerateNarrationPlan = useCallback(() => {
    if (!chapterId) return;
    void tts.generatePlan(chapterId, text, {
      project_id: projectId,
      title,
      mode: 'ai_multivoice',
    });
  }, [chapterId, projectId, text, title, tts]);

  const hasContent = text.trim().length > 0;
  const textColor = theme?.text ?? 'inherit';
  const availableProviders = tts.config
    ? (Object.entries(tts.config.providers) as [TtsProvider, TtsProviderAvailability][])
        .filter(([, v]) => v.available)
        .map(([k]) => k)
    : [];
  const noProviderAvailable = tts.config !== null && availableProviders.length === 0;
  const canUseDeviceReadAloud = tts.nativeSupported && tts.playbackEngine === 'device';
  const canPlay = hasContent && (canUseDeviceReadAloud || !noProviderAvailable);
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
      case 'missing_config':
        return t.novel.ttsErrorMissingConfig;
      case 'invalid_request':
        return t.novel.ttsErrorInvalidRequest;
      case 'unsupported_provider':
        return t.novel.ttsErrorUnsupportedProvider;
      case 'unsupported_model':
        return t.novel.ttsErrorUnsupportedModel;
      case 'unsupported_endpoint':
        return t.novel.ttsErrorUnsupportedEndpoint;
      case 'auth_failed':
        return t.novel.ttsErrorAuthFailed;
      case 'rate_limited':
        return t.novel.ttsErrorRateLimited;
      case 'provider_timeout':
        return t.novel.ttsErrorProviderTimeout;
      case 'provider_failed':
        return t.novel.ttsErrorProviderFailed;
      case 'storage_unavailable':
        return t.novel.ttsErrorStorageUnavailable;
      case 'quota_exceeded':
        return t.novel.ttsErrorQuotaExceeded;
      case 'generation_cancelled':
        return t.novel.ttsErrorGenerationCancelled;
      default:
        return visibleError;
    }
  }, [visibleError, t.novel, tts.errorCode]);

  const generationProgress = useMemo(() => {
    const progress = tts.chapterJob?.progress;
    if (!progress) return null;
    if (typeof progress.percent === 'number') return Math.round(progress.percent);
    const total = progress.total_chunks ?? progress.total_chapters ?? 0;
    const completed = progress.completed_chunks ?? progress.completed_chapters ?? 0;
    return total > 0 ? Math.round((completed / total) * 100) : null;
  }, [tts.chapterJob?.progress]);

  const narrationPlanStats = useMemo(() => {
    const plan = tts.narrationPlan;
    if (!plan) return null;
    const warnings = plan.warnings ?? [];
    const lowConfidenceSegments = plan.segments.filter((segment) => (
      typeof segment.confidence === 'number' && segment.confidence < 0.7
    ));
    return {
      speakerCount: plan.speakers.length,
      segmentCount: plan.segments.length,
      lowConfidenceWarnings: [...warnings, ...lowConfidenceSegments.map((segment) => segment.speaker_id)],
    };
  }, [tts.narrationPlan]);

  const getProviderLabel = useCallback(
    (provider: TtsProvider) => {
      switch (provider) {
        case 'openai':
          return t.novel.ttsProviderOpenAI;
        case 'volcengine':
          return t.novel.ttsProviderVolcengine;
        case 'moss-local':
          return t.novel.ttsProviderMossLocal;
        default:
          return provider;
      }
    },
    [t.novel],
  );

  const supportsAiMultivoice = supportsTtsAiMultivoice(tts.capabilities as TtsCapabilityMap | null);

  const planRequired = tts.narrationMode === 'ai_multivoice';
  const canGenerateChapter = hasContent && !tts.chapterGenerating && !tts.chapterLoading && (!planRequired || Boolean(tts.narrationPlan?.plan_id));

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`} ref={panelRef}>
      {noProviderAvailable && !canUseDeviceReadAloud ? (
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
          disabled={!canPlay || tts.loading}
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
            className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border bg-popover p-3 shadow-lg"
            role="dialog"
            aria-label={t.novel.ttsSettingsPanel}
            style={theme ? { background: theme.headerBg, borderColor: theme.border } : undefined}
          >
            {noProviderAvailable && (
              <p className="text-xs text-muted-foreground mb-2">
                {t.novel.ttsConfigHint}
              </p>
            )}

            <div className="mb-2">
              <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                {t.novel.ttsPlaybackEngine}
              </label>
              <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t.novel.ttsChoosePlaybackEngine}>
                <Button
                  size="sm"
                  variant={tts.playbackEngine === 'device' ? 'default' : 'outline'}
                  onClick={() => tts.setPlaybackEngine('device')}
                  disabled={!tts.nativeSupported}
                  className="h-7 min-w-0 px-2 text-xs"
                  role="radio"
                  aria-checked={tts.playbackEngine === 'device'}
                >
                  <Smartphone className="mr-1 h-3 w-3" />
                  <span className="truncate">{t.novel.ttsDeviceReadAloud}</span>
                </Button>
                <Button
                  size="sm"
                  variant={tts.playbackEngine === 'server' ? 'default' : 'outline'}
                  onClick={() => tts.setPlaybackEngine('server')}
                  disabled={noProviderAvailable}
                  className="h-7 min-w-0 px-2 text-xs"
                  role="radio"
                  aria-checked={tts.playbackEngine === 'server'}
                >
                  <Server className="mr-1 h-3 w-3" />
                  <span className="truncate">{t.novel.ttsAiAudiobook}</span>
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {tts.playbackEngine === 'device' ? t.novel.ttsDeviceReadAloudHint : t.novel.ttsAiAudiobookHint}
              </p>
            </div>

            {tts.playbackEngine === 'device' && (
              <div className="mb-2 rounded-md border p-2" style={{ borderColor: theme?.border }}>
                <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                  {t.novel.ttsDeviceVoice}
                </label>
                {tts.nativeVoices.length > 0 ? (
                  <div className="mb-2 max-h-24 overflow-y-auto space-y-1">
                    {tts.nativeVoices.slice(0, 8).map((voice) => (
                      <Button
                        key={voice.id}
                        size="sm"
                        variant={tts.nativeVoiceId === voice.id ? 'default' : 'outline'}
                        onClick={() => tts.setNativeVoiceId(voice.id)}
                        className="h-7 w-full justify-start px-2 text-xs"
                      >
                        <span className="truncate">{voice.name} · {voice.lang}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="mb-2 text-[11px] text-muted-foreground">{t.novel.ttsDeviceVoiceUnavailable}</p>
                )}
                <div className="space-y-2">
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>{t.novel.ttsDeviceRate}</span>
                      <span>{tts.nativeRate.toFixed(1)}x</span>
                    </div>
                    <Slider
                      value={[tts.nativeRate]}
                      min={0.5}
                      max={2}
                      step={0.1}
                      onValueChange={(value) => tts.setNativeRate(value[0] ?? 1)}
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>{t.novel.ttsDevicePitch}</span>
                      <span>{tts.nativePitch.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[tts.nativePitch]}
                      min={0.5}
                      max={2}
                      step={0.1}
                      onValueChange={(value) => tts.setNativePitch(value[0] ?? 1)}
                    />
                  </div>
                </div>
              </div>
            )}

            {tts.playbackEngine === 'server' && availableProviders.length > 1 && (
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
                      {getProviderLabel(p)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {tts.playbackEngine === 'server' && tts.voices.length > 0 && (
              <div className="mb-2">
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

            {tts.playbackEngine === 'server' && chapterId && (
              <div className="mb-2 border-t pt-2" style={{ borderColor: theme?.border }}>
                <div className="mb-2">
                  <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                    {t.novel.ttsNarrationMode}
                  </label>
                  <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t.novel.ttsChooseNarrationMode}>
                    <Button
                      size="sm"
                      variant={tts.narrationMode === 'single_narrator' ? 'default' : 'outline'}
                      onClick={() => handleNarrationModeChange('single_narrator')}
                      className="h-7 min-w-0 px-2 text-xs"
                      role="radio"
                      aria-checked={tts.narrationMode === 'single_narrator'}
                    >
                      <span className="truncate">{t.novel.ttsSingleNarrator}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={tts.narrationMode === 'ai_multivoice' ? 'default' : 'outline'}
                      onClick={() => handleNarrationModeChange('ai_multivoice')}
                      disabled={!supportsAiMultivoice}
                      className="h-7 min-w-0 px-2 text-xs"
                      role="radio"
                      aria-checked={tts.narrationMode === 'ai_multivoice'}
                    >
                      <span className="truncate">{t.novel.ttsAiMultivoice}</span>
                    </Button>
                  </div>
                </div>

                {tts.narrationMode === 'ai_multivoice' && (
                  <div className="mb-2 rounded-md border p-2" style={{ borderColor: theme?.border }}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium" style={{ color: textColor }}>
                        {t.novel.ttsNarrationPlan}
                      </span>
                      {tts.narrationPlan?.confidence != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {t.novel.ttsPlanConfidence(Math.round(tts.narrationPlan.confidence * 100))}
                        </span>
                      )}
                    </div>

                    {narrationPlanStats ? (
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">
                          {t.novel.ttsPlanSummary(narrationPlanStats.speakerCount, narrationPlanStats.segmentCount)}
                        </p>
                        {narrationPlanStats.lowConfidenceWarnings.length > 0 && (
                          <p className="text-[11px] text-amber-600">
                            {t.novel.ttsLowConfidenceWarnings(narrationPlanStats.lowConfidenceWarnings.length)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {t.novel.ttsNarrationPlanEmpty}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleLoadNarrationPlan}
                        disabled={tts.narrationPlanLoading || tts.narrationPlanGenerating}
                        className="h-7 px-2 text-xs"
                      >
                        {tts.narrationPlanLoading ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-3 w-3" />
                        )}
                        {t.novel.ttsLoadNarrationPlan}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleGenerateNarrationPlan}
                        disabled={!hasContent || tts.narrationPlanLoading || tts.narrationPlanGenerating}
                        className="h-7 px-2 text-xs"
                      >
                        {tts.narrationPlanGenerating ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-3 w-3" />
                        )}
                        {t.novel.ttsGenerateNarrationPlan}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium" style={{ color: textColor }}>
                    {t.novel.ttsChapterAudio}
                  </span>
                  {tts.chapterCacheState !== 'unknown' && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {tts.chapterCacheState === 'hit' ? t.novel.ttsCacheHit : t.novel.ttsCacheMiss}
                    </span>
                  )}
                </div>

                {generationProgress !== null && (
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${generationProgress}%` }} />
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateChapter}
                    disabled={!canGenerateChapter}
                    className="h-7 px-2 text-xs"
                  >
                    {tts.chapterGenerating || tts.chapterLoading ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {planRequired ? t.novel.ttsGenerateChapterWithPlan : tts.chapterAudio ? t.novel.ttsReuseChapterAudio : t.novel.ttsGenerateChapterAudio}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleForceGenerateChapter}
                    disabled={!hasContent || tts.chapterGenerating || (planRequired && !tts.narrationPlan?.plan_id)}
                    className="h-7 px-2 text-xs"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    {t.novel.ttsRegenerateChapterAudio}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownload}
                    disabled={!tts.downloadUrl}
                    className="h-7 px-2 text-xs"
                  >
                    <Download className="mr-1 h-3 w-3" />
                    {t.novel.ttsDownloadAudio}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void tts.exportChapterInBrowser()}
                    disabled={!tts.browserExportSupported || !tts.browserExportAvailable || tts.browserExporting}
                    className="h-7 px-2 text-xs"
                    title={t.novel.ttsBrowserExportHint}
                  >
                    {tts.browserExporting ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="mr-1 h-3 w-3" />
                    )}
                    {t.novel.ttsBrowserExportMp3}
                  </Button>
                  {tts.chapterGenerating && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void tts.cancelChapterJob()}
                      className="h-7 px-2 text-xs"
                    >
                      <Ban className="mr-1 h-3 w-3" />
                      {t.novel.ttsCancelJob}
                    </Button>
                  )}
                  {tts.chapterJob?.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void tts.retryChapterJob()}
                      className="h-7 px-2 text-xs"
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      {t.novel.ttsRetryJob}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {tts.playbackEngine === 'server' && (
              <div className="border-t pt-2" style={{ borderColor: theme?.border }}>
                <label className="text-xs font-medium mb-1 block" style={{ color: textColor }}>
                  {t.novel.ttsNarrationInstructions}
                </label>
                <textarea
                  value={tts.instructions ?? ''}
                  onChange={(event) => tts.setInstructions(event.target.value || undefined)}
                  placeholder={t.novel.ttsNarrationInstructionsPlaceholder}
                  className="mb-2 min-h-14 w-full resize-none rounded-md border bg-background px-2 py-1 text-xs"
                  disabled={tts.capabilities?.instructions === false}
                />

                <div className="grid grid-cols-2 gap-1">
                  <CapabilityToggle
                    label={t.novel.ttsRoleVoices}
                    supported={supportsAiMultivoice}
                    active={tts.narrationMode === 'ai_multivoice'}
                    onClick={() => handleNarrationModeChange(tts.narrationMode === 'ai_multivoice' ? 'single_narrator' : 'ai_multivoice')}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{t.novel.ttsUnsupportedHint}</p>
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

export function supportsTtsAiMultivoice(capabilities: TtsCapabilityMap | null | undefined): boolean {
  return capabilities?.advanced_features?.multi_voice === true || capabilities?.advanced_features?.narration_plan === true;
}

function CapabilityToggle({
  label,
  supported,
  active,
  onClick,
}: {
  label: string;
  supported: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      disabled={!supported}
      className="h-7 min-w-0 px-1.5 text-[11px]"
      title={supported ? label : `${label} unsupported`}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
