import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://backend.test',
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

describe('NovelApiService finalize gate APIs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests consistency report endpoint with GET', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockResponse({ result: 'pass' }));

    const result = await novelApiService.getConsistencyReport('proj-1');

    expect(result).toEqual({ result: 'pass' });
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://backend.test/api/polish/projects/proj-1/consistency-report');
    expect(options?.method).toBe('GET');
  });

  it('posts finalize-gate payload to gate endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockResponse({ result: 'warn' }));

    await novelApiService.checkFinalizeGate('proj-2', { low_score_warn_threshold: 6.8 });

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://backend.test/api/polish/projects/proj-2/finalize-gate');
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe(JSON.stringify({ low_score_warn_threshold: 6.8 }));
  });

  it('keeps gate_report in finalize 409 error details', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        {
          detail: {
            message: '定稿门禁未通过',
            gate_report: {
              result: 'block',
              summary: { block_checks: 2, warn_checks: 1, total_issues: 4 },
            },
          },
        },
        409,
      ),
    );

    await expect(novelApiService.finalizeProject('proj-3')).rejects.toMatchObject({
      status: 409,
      details: {
        gate_report: {
          result: 'block',
          summary: { block_checks: 2, warn_checks: 1, total_issues: 4 },
        },
      },
    });
  });
});
