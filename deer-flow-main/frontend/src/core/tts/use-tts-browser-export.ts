'use client';

import { useCallback, useEffect, useState } from 'react';

import type { TtsChapterAudioManifest } from './api';
import { canExportManifestInBrowser, downloadBlob, exportChapterMp3InBrowser } from './browserFfmpegExport';
import type { TtsState } from './tts-state';

export interface UseTtsBrowserExportReturn {
  browserExporting: boolean;
  browserExportSupported: boolean;
  browserExportAvailable: boolean;
  exportChapterInBrowser: () => Promise<{ blob: Blob; filename: string } | null>;
}

export function useTtsBrowserExport(
  chapterAudio: TtsChapterAudioManifest | null,
  onStateChange: (updates: Partial<TtsState>) => void,
): UseTtsBrowserExportReturn {
  const [browserExporting, setBrowserExporting] = useState(false);
  const browserExportSupported = typeof window !== 'undefined' && typeof WebAssembly !== 'undefined';
  const browserExportAvailable = canExportManifestInBrowser(chapterAudio);

  useEffect(() => {
    onStateChange({
      browserExportSupported,
      browserExportAvailable,
    });
  }, [browserExportAvailable, browserExportSupported, onStateChange]);

  const exportChapterInBrowser = useCallback(async () => {
    if (!chapterAudio) return null;
    setBrowserExporting(true);
    onStateChange({
      browserExporting: true,
      error: null,
      errorCode: null,
    });
    try {
      const result = await exportChapterMp3InBrowser(chapterAudio);
      downloadBlob(result.blob, result.filename);
      setBrowserExporting(false);
      onStateChange({ browserExporting: false });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Browser MP3 export failed';
      setBrowserExporting(false);
      onStateChange({
        browserExporting: false,
        error: message,
        errorCode: 'provider_failed',
      });
      return null;
    }
  }, [chapterAudio, onStateChange]);

  return {
    browserExporting,
    browserExportSupported,
    browserExportAvailable,
    exportChapterInBrowser,
  };
}
