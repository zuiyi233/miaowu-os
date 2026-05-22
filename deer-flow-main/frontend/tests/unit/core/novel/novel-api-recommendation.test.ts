import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/config', () => ({
  getBackendBaseURL: () => 'http://backend.test',
}));

import { novelApiService } from '@/core/novel/novel-api';

describe('NovelApiService recommendations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses dedicated /ignore endpoint for ignored recommendations', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{}'),
    } as unknown as Response);

    await novelApiService.ignoreRecommendation('novel-1', 'rec-1');

    const [ignoreUrl, ignoreOptions] = fetchMock.mock.calls[0] ?? [];
    expect(ignoreUrl).toBe(
      'http://backend.test/api/novels/novel-1/recommendations/rec-1/ignore',
    );
    expect(ignoreOptions?.method).toBe('POST');
  });
});
