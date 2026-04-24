export interface PromptWorkshopQuery {
  searchTerm?: string;
  categoryFilter?: string;
}

export interface PromptTemplateCreateInput {
  template_name: string;
  template_content: string;
  description: string;
  category: string;
  parameters?: string;
}

function slugifyTemplateKey(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || 'custom-template';
}

export function buildPromptWorkshopItemsUrl(
  backendBase: string,
  query: PromptWorkshopQuery = {},
): string {
  const params = new URLSearchParams();
  if (query.searchTerm) params.set('search', query.searchTerm);
  if (query.categoryFilter && query.categoryFilter !== 'all') {
    params.set('category', query.categoryFilter);
  }
  const queryString = params.toString();
  return `${backendBase}/api/prompt-workshop/items${queryString ? `?${queryString}` : ''}`;
}

export function buildPromptTemplatesUrl(backendBase: string): string {
  return `${backendBase}/api/prompt-templates`;
}

export function buildPromptWorkshopLikeUrl(backendBase: string, itemId: string): string {
  return `${backendBase}/api/prompt-workshop/items/${itemId}/like`;
}

export function buildPromptTemplateDeleteUrl(backendBase: string, templateKey: string): string {
  return `${backendBase}/api/prompt-templates/${encodeURIComponent(templateKey)}`;
}

export function buildPromptTemplateCreatePayload(
  input: PromptTemplateCreateInput,
  projectId?: string,
): Record<string, unknown> {
  const suffix = Date.now().toString(36);
  const baseKey = slugifyTemplateKey(input.template_name);
  return {
    template_key: `${baseKey}-${suffix}`,
    template_name: input.template_name,
    template_content: input.template_content,
    description: input.description,
    category: input.category || 'general',
    parameters: input.parameters || undefined,
    is_active: true,
    project_id: projectId || undefined,
  };
}

export function extractWorkshopItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(record.items)) return record.items as Record<string, unknown>[];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)) {
    return (data as Record<string, unknown>).items as Record<string, unknown>[];
  }
  return [];
}

export function extractPromptTemplates(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.templates)) return record.templates as Record<string, unknown>[];
  const data = record.data;
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).templates)) {
    return (data as Record<string, unknown>).templates as Record<string, unknown>[];
  }
  if (Array.isArray(record.items)) return record.items as Record<string, unknown>[];
  return [];
}
