import { describe, expect, it } from 'vitest';

import { canExportManifestInBrowser } from '@/core/tts/browserFfmpegExport';

describe('browser ffmpeg export gates', () => {
  it('only enables browser export for multi-segment mp3 manifests', () => {
    expect(canExportManifestInBrowser(null)).toBe(false);
    expect(canExportManifestInBrowser({
      chapter_id: 'chapter-1',
      content_type: 'audio/mpeg',
      segments: [
        { index: 0, content_type: 'audio/mpeg', download_url: '/a.mp3' },
      ],
    })).toBe(false);
    expect(canExportManifestInBrowser({
      chapter_id: 'chapter-1',
      content_type: 'audio/wav',
      segments: [
        { index: 0, content_type: 'audio/wav', download_url: '/a.wav' },
        { index: 1, content_type: 'audio/wav', download_url: '/b.wav' },
      ],
    })).toBe(false);
    expect(canExportManifestInBrowser({
      chapter_id: 'chapter-1',
      content_type: 'audio/mpeg',
      segments: [
        { index: 0, content_type: 'audio/mpeg', download_url: '/a.mp3' },
        { index: 1, content_type: 'audio/mpeg', download_url: '/b.mp3' },
      ],
    })).toBe(true);
  });
});
