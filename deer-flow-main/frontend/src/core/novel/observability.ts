export type NovelEventName =
  | 'novel_open'
  | 'chapter_save'
  | 'ai_generate_start'
  | 'ai_generate_complete'
  | 'ai_generate_error'
  | 'recommendation_accept'
  | 'annotation_resolve';

export interface NovelEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  name: NovelEventName;
  payload: TPayload;
  timestamp: string;
}

const EVENT_TYPE = 'novel:metric';

export function emitNovelEvent<TPayload extends Record<string, unknown>>(
  name: NovelEventName,
  payload: TPayload,
) {
  const event: NovelEvent<TPayload> = {
    name,
    payload,
    timestamp: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: event }));
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.debug('[novel:metric]', event);
  }
}

export const novelMetricEventType = EVENT_TYPE;
