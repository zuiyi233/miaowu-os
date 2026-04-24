import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://backend.test',
}));

import { novelApiService } from '@/core/novel/novel-api';

function mockJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function mockTextResponse(text: string, status = 500): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(text),
    json: vi.fn().mockRejectedValue(new Error('json() should not be used')),
  } as unknown as Response;
}

describe('NovelApiService book import contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps legacy extract_mode values to backend contract', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ task_id: 'task-1' }));

    const file = new File(['dummy'], 'book.txt', { type: 'text/plain' });
    const result = await novelApiService.createBookImportTask(file, {
      extractMode: 'full_book_reverse',
      tailChapterCount: 20,
    });

    expect(result.taskId).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://backend.test/book-import/tasks');
    const formData = options?.body as FormData;
    expect(formData.get('extract_mode')).toBe('full');
    expect(formData.get('tail_chapter_count')).toBe('20');
  });

  it('uses /book-import prefix for task status and preview APIs', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ task_id: 'tid', status: 'running', progress: 30, message: 'ok' }))
      .mockResolvedValueOnce(mockJsonResponse({
        task_id: 'tid',
        project_suggestion: {
          title: '项目A',
          genre: '玄幻',
          theme: '成长',
          description: '简介',
          narrative_perspective: '第三人称',
          target_words: 120000,
        },
        chapters: [{ chapter_number: 1, title: '第一章', summary: '摘要', content: '内容' }],
        outlines: [],
        warnings: [{ code: 'w1', level: 'info', message: '提示' }],
      }));

    const status = await novelApiService.getBookImportTaskStatus('tid');
    const preview = await novelApiService.getBookImportPreview('tid');

    expect(status.taskId).toBe('tid');
    expect(status.status).toBe('running');
    expect(status.progress).toBe(30);

    expect(preview.projectSuggestion.narrativePerspective).toBe('第三人称');
    expect(preview.projectSuggestion.targetWords).toBe(120000);
    expect(preview.chapters[0]?.chapterNumber).toBe(1);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://backend.test/book-import/tasks/tid');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://backend.test/book-import/tasks/tid/preview');
  });

  it('sends retry payload with steps field', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      {
        ok: true,
        status: 200,
      } as Response,
    );

    await novelApiService.retryBookImportStepsStream('tid', ['world_building', 'career_system']);

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://backend.test/book-import/tasks/tid/retry-stream');
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe(JSON.stringify({ steps: ['world_building', 'career_system'] }));
  });

  it('raises ApiError for non-JSON book import error bodies', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockTextResponse('Internal Server Error', 500));

    const statusPromise = novelApiService.getBookImportTaskStatus('tid');

    await expect(statusPromise).rejects.not.toBeInstanceOf(SyntaxError);
    await expect(statusPromise).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: expect.stringContaining('500'),
      details: 'Internal Server Error',
    });
  });

  it('rejects applyBookImportStream with status and parsed details on non-2xx', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: 'stream failed' }, 503));

    await expect(
      novelApiService.applyBookImportStream('tid', { mode: 'tail' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      details: { error: 'stream failed' },
    });
  });

  it('rejects retryBookImportStepsStream with status and parsed details on non-2xx', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: 'retry failed' }, 502));

    await expect(
      novelApiService.retryBookImportStepsStream('tid', ['outline', 'chapter']),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      details: { error: 'retry failed' },
    });
  });
});
