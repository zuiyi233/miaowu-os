import { describe, expect, it } from 'vitest';

import {
  buildPromptTemplatesUrl,
  buildPromptWorkshopItemsUrl,
  extractWorkshopItems,
} from '@/components/novel/prompt-workshop-api';

describe('PromptWorkshop API routing contract', () => {
  it('uses /api/prompt-workshop/items for community list query', () => {
    const url = buildPromptWorkshopItemsUrl('http://127.0.0.1:8551', {
      searchTerm: '主角',
      categoryFilter: 'plot',
    });

    expect(url).toBe(
      'http://127.0.0.1:8551/api/prompt-workshop/items?search=%E4%B8%BB%E8%A7%92&category=plot',
    );
  });

  it('accepts nested backend response shape for workshop items', () => {
    const items = extractWorkshopItems({
      success: true,
      data: {
        items: [{ id: 'item-1', name: '剧情模板' }],
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('item-1');
  });

  it('uses /api/prompt-templates for user template list', () => {
    expect(buildPromptTemplatesUrl('http://127.0.0.1:8551')).toBe(
      'http://127.0.0.1:8551/api/prompt-templates',
    );
  });
});
