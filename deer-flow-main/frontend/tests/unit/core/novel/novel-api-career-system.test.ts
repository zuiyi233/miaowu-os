import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://backend.test',
}));

import { novelApiService } from '@/core/novel/novel-api';

function mockTextResponse(responseText: string, status = 200): Response {
  const cloned = {
    text: vi.fn().mockResolvedValue(responseText),
  } as unknown as Response;

  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    clone: vi.fn().mockReturnValue(cloned),
    text: vi.fn().mockResolvedValue(responseText),
  } as unknown as Response;
}

describe('NovelApiService.generateCareerSystem', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses normal SSE result payload and supports snake_case / camelCase fields', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockTextResponse([
        'data: {"type":"progress","progress":30,"message":"生成中"}',
        '',
        'data: {"type":"result","data":{"main_careers_count":"2","subCareersCount":"1","main_careers":["剑修",{"name":"符师"}],"subCareers":[{"title":"炼丹师"}]}}',
        '',
        'data: {"type":"done"}',
        '',
      ].join('\n')),
    );

    const result = await novelApiService.generateCareerSystem('proj-1');

    expect(result.mainCareersCount).toBe(2);
    expect(result.subCareersCount).toBe(1);
    expect(result.mainCareers).toEqual(['剑修', '符师']);
    expect(result.subCareers).toEqual(['炼丹师']);
    expect(result.events).toHaveLength(3);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBeNull();
  });

  it('returns safe fallback values when response body is empty', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockTextResponse('   '));

    const result = await novelApiService.generateCareerSystem('proj-empty');

    expect(result.mainCareersCount).toBe(0);
    expect(result.subCareersCount).toBe(0);
    expect(result.mainCareers).toEqual([]);
    expect(result.subCareers).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('constructs query params correctly, including 0 and boolean false values', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockTextResponse(
        JSON.stringify({
          mainCareersCount: 1,
          sub_careers_count: 2,
          mainCareers: ['道士'],
          sub_careers: ['丹师', '阵师'],
        }),
      ),
    );

    const result = await novelApiService.generateCareerSystem('proj-query', {
      mainCareerCount: 0,
      subCareerCount: 6,
      userRequirements: '法师 与 剑士',
      enableMcp: false,
    });

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(typeof url).toBe('string');
    const requestUrl = new URL(url as string);

    expect(options?.method).toBe('GET');
    expect(requestUrl.pathname).toBe('/api/careers/generate-system');
    expect(requestUrl.searchParams.get('project_id')).toBe('proj-query');
    expect(requestUrl.searchParams.get('main_career_count')).toBe('0');
    expect(requestUrl.searchParams.get('sub_career_count')).toBe('6');
    expect(requestUrl.searchParams.get('user_requirements')).toBe('法师 与 剑士');
    expect(requestUrl.searchParams.get('enable_mcp')).toBe('false');

    expect(result.mainCareersCount).toBe(1);
    expect(result.subCareersCount).toBe(2);
    expect(result.mainCareers).toEqual(['道士']);
    expect(result.subCareers).toEqual(['丹师', '阵师']);
  });

  it('does not eagerly consume stream body for event-stream responses', async () => {
    const fetchMock = vi.mocked(fetch);
    const cloneSpy = vi.fn();
    const streamResponse = {
      ok: true,
      status: 200,
      body: { getReader: vi.fn() } as unknown as ReadableStream<Uint8Array>,
      headers: {
        get: vi.fn().mockImplementation((name: string) =>
          name.toLowerCase() === 'content-type' ? 'text/event-stream' : null,
        ),
      } as unknown as Headers,
      clone: cloneSpy,
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(streamResponse);

    const result = await novelApiService.generateCareerSystem('proj-stream');

    expect(cloneSpy).not.toHaveBeenCalled();
    expect(result.body).toBe(streamResponse.body);
    expect(result.events).toEqual([]);
    expect(result.mainCareersCount).toBe(0);
    expect(result.subCareersCount).toBe(0);
  });
});
