import { fetch as authFetch } from '@/core/api/fetcher';

import type { TtsChapterAudioManifest } from './api';

export interface BrowserMp3ExportResult {
  blob: Blob;
  filename: string;
}

export function canUseBrowserFfmpegExport(): boolean {
  return typeof window !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export function canExportManifestInBrowser(audio: TtsChapterAudioManifest | null): boolean {
  if (!audio?.segments || audio.segments.length <= 1) return false;
  return audio.segments.every((segment) => {
    const contentType = (segment.content_type || audio.content_type || '').toLowerCase();
    return contentType === 'audio/mpeg' || contentType === 'audio/mp3';
  });
}

function resolveSegmentUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

async function loadFfmpeg() {
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  return { ffmpeg, fetchFile };
}

export async function exportChapterMp3InBrowser(audio: TtsChapterAudioManifest): Promise<BrowserMp3ExportResult> {
  if (!canUseBrowserFfmpegExport()) {
    throw new Error('Browser FFmpeg export is not supported on this device');
  }
  if (!canExportManifestInBrowser(audio)) {
    throw new Error('Only multi-segment MP3 chapter audio can be exported in the browser');
  }

  const { ffmpeg, fetchFile } = await loadFfmpeg();
  const listLines: string[] = [];

  for (const [index, segment] of (audio.segments ?? []).entries()) {
    const url = resolveSegmentUrl(segment.download_url ?? segment.url);
    if (!url) throw new Error('Chapter audio segment is missing a download URL');
    const path = `chunk_${String(index).padStart(5, '0')}.mp3`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio segment ${index + 1}`);
    await ffmpeg.writeFile(path, await fetchFile(await response.blob()));
    listLines.push(`file '${path.replace(/'/g, "'\\''")}'`);
  }

  await ffmpeg.writeFile('concat.txt', listLines.join('\n'));
  let exitCode = await ffmpeg.exec([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'concat.txt',
    '-vn',
    '-c',
    'copy',
    'chapter.mp3',
  ]);

  if (exitCode !== 0) {
    exitCode = await ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-vn',
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      'chapter.mp3',
    ]);
  }
  if (exitCode !== 0) throw new Error('Browser FFmpeg failed to export MP3');

  const data = await ffmpeg.readFile('chapter.mp3');
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const audioBytes = new Uint8Array(bytes.byteLength);
  audioBytes.set(bytes);
  return {
    blob: new Blob([audioBytes], { type: 'audio/mpeg' }),
    filename: `tts_${audio.chapter_id}.mp3`,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
