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
  } as unknown as Response;
}

describe('NovelApiService careers routing payload', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes routing payload via query/body for careers APIs', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ total: 0, main_careers: [], sub_careers: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const routing = {
      module_id: 'novel-careers',
      ai_provider_id: 'provider-1',
      ai_model: 'gpt-4o',
    };

    await novelApiService.getCareers('project-1', routing);
    await novelApiService.createCareer({ project_id: 'project-1', name: '剑修' }, routing);
    await novelApiService.updateCareer('career-1', { name: '剑修（进阶）' }, routing);

    const getCareersUrlRaw = fetchMock.mock.calls[0]?.[0];
    expect(typeof getCareersUrlRaw).toBe('string');
    const getCareersUrl = new URL(getCareersUrlRaw as string);
    expect(getCareersUrl.searchParams.get('module_id')).toBe('novel-careers');
    expect(getCareersUrl.searchParams.get('ai_provider_id')).toBe('provider-1');
    expect(getCareersUrl.searchParams.get('ai_model')).toBe('gpt-4o');

    const createBodyRaw = fetchMock.mock.calls[1]?.[1]?.body;
    expect(typeof createBodyRaw).toBe('string');
    const createBody = JSON.parse(createBodyRaw as string);
    expect(createBody).toMatchObject(routing);

    const updateBodyRaw = fetchMock.mock.calls[2]?.[1]?.body;
    expect(typeof updateBodyRaw).toBe('string');
    const updateBody = JSON.parse(updateBodyRaw as string);
    expect(updateBody).toMatchObject(routing);
  });
});
