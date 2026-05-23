import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://127.0.0.1:8551',
}));

import { novelApiService } from '@/core/novel/novel-api';

function mockResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe('NovelApiService author control APIs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses 8551 backend base and author-control context preview route', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockResponse({ context_hash: 'abc', rag_hits: [], character_states: [], foreshadows: [] }));

    await novelApiService.previewAuthorContext('proj-1', { chapter_id: 'ch-1', task_kind: 'continue' });

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8551/api/projects/proj-1/author-control/context-preview');
    expect(String(url)).not.toContain('8001');
    expect(options?.method).toBe('POST');
  });

  it('calls scene, issue, version routes with expected methods', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockResponse({ items: [] }))
      .mockResolvedValueOnce(mockResponse({ items: [] }))
      .mockResolvedValueOnce(mockResponse({ version: { id: 'v1' } }))
      .mockResolvedValueOnce(mockResponse({ version: { id: 'v1' }, chapter_id: 'ch-1' }));

    await novelApiService.planSceneCards('proj-1', 'ch-1', { user_instruction: 'plan' });
    await novelApiService.critiqueChapter('proj-1', 'ch-1');
    await novelApiService.reviseChapter('ch-1', { instruction: 'fix' });
    await novelApiService.acceptDraftVersion('v1');

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['http://127.0.0.1:8551/api/projects/proj-1/chapters/ch-1/scenes/plan', 'POST'],
      ['http://127.0.0.1:8551/api/projects/proj-1/chapters/ch-1/critique', 'POST'],
      ['http://127.0.0.1:8551/api/chapters/ch-1/revise', 'POST'],
      ['http://127.0.0.1:8551/api/versions/v1/accept', 'POST'],
    ]);
  });
});
