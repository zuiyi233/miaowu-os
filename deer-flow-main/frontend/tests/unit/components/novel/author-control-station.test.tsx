import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/core/novel/queries', () => ({
  useNovelQuery: () => ({
    data: {
      id: 'proj-1',
      title: '雾城',
      chapters: [
        {
          id: 'ch-1',
          title: '暗门',
          content: '旧正文',
          wordCount: 3,
          status: 'draft',
          order: 1,
        },
      ],
    },
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AuthorControlStation } from '@/components/novel/author-control/AuthorControlStation';

describe('AuthorControlStation', () => {
  it('renders core author workflow panels', () => {
    const html = renderToStaticMarkup(<AuthorControlStation novelId="proj-1" />);

    expect(html).toContain('作者控制台');
    expect(html).toContain('上下文包');
    expect(html).toContain('场景卡');
    expect(html).toContain('证据化审校');
    expect(html).toContain('版本与 Diff');
    expect(html).toContain('生成候选');
  });
});
