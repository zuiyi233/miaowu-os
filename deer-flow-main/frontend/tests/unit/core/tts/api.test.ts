import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuth = vi.fn();

vi.mock('@/core/api/fetcher', () => ({
  fetch: fetchWithAuth,
}));

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://127.0.0.1:8551',
}));

beforeEach(() => {
  fetchWithAuth.mockReset();
});

describe('tts api contract', () => {
  it('sends capability-aware synthesis options without calling providers directly', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio'], { type: 'audio/wav' }),
    });

    const { synthesizeSpeech } = await import('@/core/tts/api');

    await synthesizeSpeech({
      text: '你好',
      provider: 'moss-local',
      voice: 'demo-1',
      model: 'moss-tts-nano',
      fmt: 'wav',
      speed: 1.1,
      instructions: '温柔旁白',
      advanced_options: {
        seed: 42,
        text_temperature: 0.7,
        normalize_text: true,
      },
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      'http://127.0.0.1:8551/api/tts/synthesize',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const [, init] = fetchWithAuth.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      provider: 'moss-local',
      voice: 'demo-1',
      model: 'moss-tts-nano',
      fmt: 'wav',
      speed: 1.1,
      instructions: '温柔旁白',
      advanced_options: {
        seed: 42,
        text_temperature: 0.7,
        normalize_text: true,
      },
    });
  });

  it('preserves backend stable error codes from structured detail bodies', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        detail: {
          code: 'missing_config',
          message: 'TTS provider is not configured',
        },
      }),
    });

    const { synthesizeSpeech, TtsApiError } = await import('@/core/tts/api');

    const promise = synthesizeSpeech({ text: 'hello' });

    await expect(promise).rejects.toMatchObject({
      name: 'TtsApiError',
      code: 'missing_config',
      status: 503,
      message: 'TTS provider is not configured',
    });
    await expect(promise).rejects.toBeInstanceOf(TtsApiError);
  });

  it('accepts backend error_code from HTTPException detail bodies', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        detail: {
          error_code: 'provider_failed',
          message: 'TTS provider failed',
        },
      }),
    });

    const { synthesizeSpeech } = await import('@/core/tts/api');

    await expect(synthesizeSpeech({ text: 'hello' })).rejects.toMatchObject({
      name: 'TtsApiError',
      code: 'provider_failed',
      status: 502,
      message: 'TTS provider failed',
    });
  });

  it('passes provider and model when loading voices', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [] }),
    });

    const { fetchTtsVoices } = await import('@/core/tts/api');

    await fetchTtsVoices('openai', 'gpt-4o-mini-tts');

    expect(fetchWithAuth).toHaveBeenCalledWith(
      'http://127.0.0.1:8551/api/tts/voices?provider=openai&model=gpt-4o-mini-tts',
    );
  });

  it('generates chapter audio through the Miaowu gateway contract', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        job_id: 'job-1',
        cache_state: 'miss',
      }),
    });

    const { generateChapterAudio } = await import('@/core/tts/api');

    await generateChapterAudio({
      chapter_id: 'chapter-1',
      project_id: 'novel-1',
      title: '第一章',
      text: '章节正文',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      instructions: '稳定旁白',
      mode: 'ai_multivoice',
      plan_id: 'plan-1',
      speaker_voices: {
        narrator: 'alloy',
        character_a: 'nova',
      },
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      'http://127.0.0.1:8551/api/tts/chapters/chapter-1/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const [, init] = fetchWithAuth.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      text: '章节正文',
      project_id: 'novel-1',
      title: '第一章',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      instructions: '稳定旁白',
      mode: 'ai_multivoice',
      plan_id: 'plan-1',
      speaker_voices: {
        narrator: 'alloy',
        character_a: 'nova',
      },
    });
  });

  it('loads chapter audio and controls tts jobs through gateway endpoints', async () => {
    fetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          audio: {
            chapter_id: 'chapter-1',
            download_url: '/api/media-assets/audio-1/download',
            cache_state: 'hit',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job_id: 'job-1', status: 'running' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          job: {
            job_id: 'job-1',
            status: 'cancelled',
            error_code: 'generation_cancelled',
            detail: 'Chapter TTS generation was cancelled',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          job: {
            job_id: 'job-1',
            status: 'queued',
          },
        }),
      });

    const { getChapterAudio, getTtsJob, cancelTtsJob, retryTtsJob } = await import('@/core/tts/api');

    await getChapterAudio('chapter-1', {
      project_id: 'novel-1',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      mode: 'ai_multivoice',
      plan_id: 'plan-1',
      speaker_voices: {
        character_a: 'nova',
        narrator: 'alloy',
      },
    });
    await getTtsJob('job-1');
    const cancelled = await cancelTtsJob('job-1');
    const retried = await retryTtsJob('job-1');

    expect(cancelled).toMatchObject({
      job_id: 'job-1',
      status: 'cancelled',
      error: {
        code: 'generation_cancelled',
        message: 'Chapter TTS generation was cancelled',
      },
    });
    expect(retried).toMatchObject({
      job_id: 'job-1',
      status: 'queued',
    });

    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8551/api/tts/chapters/chapter-1/audio?project_id=novel-1&provider=openai&model=gpt-4o-mini-tts&voice=alloy&mode=ai_multivoice&plan_id=plan-1&speaker_voices=%7B%22character_a%22%3A%22nova%22%2C%22narrator%22%3A%22alloy%22%7D',
      expect.objectContaining({ signal: undefined }),
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8551/api/tts/jobs/job-1',
      { signal: undefined },
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:8551/api/tts/jobs/job-1/cancel',
      { method: 'POST' },
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:8551/api/tts/jobs/job-1/retry',
      { method: 'POST' },
    );
  });

  it('normalizes relative chapter audio download urls to the backend gateway', async () => {
    const { getChapterAudioDownloadUrl } = await import('@/core/tts/api');

    expect(getChapterAudioDownloadUrl({
      chapter_id: 'chapter-1',
      download_url: '/api/tts/chapters/chapter-1/download',
    })).toBe('http://127.0.0.1:8551/api/tts/chapters/chapter-1/download');

    expect(getChapterAudioDownloadUrl({
      chapter_id: 'chapter-1',
      download_url: 'https://cdn.example/audio.wav',
    })).toBe('https://cdn.example/audio.wav');
  });

  it('falls back to chapter download endpoint for multi-segment manifests without top-level urls', async () => {
    const { getChapterAudioDownloadUrl } = await import('@/core/tts/api');

    expect(getChapterAudioDownloadUrl({
      chapter_id: 'chapter 1/part 2',
      segments: [
        { index: 0, download_url: '/api/media-assets/chunk-1/download' },
        { index: 1, download_url: '/api/media-assets/chunk-2/download' },
      ],
    })).toBe('http://127.0.0.1:8551/api/tts/chapters/chapter%201%2Fpart%202/download');
  });
});
