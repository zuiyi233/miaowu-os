export function cleanupAudio(audio: HTMLAudioElement | null, blobUrl: string | null) {
  if (audio) {
    audio.onloadedmetadata = null;
    audio.ontimeupdate = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }
}
