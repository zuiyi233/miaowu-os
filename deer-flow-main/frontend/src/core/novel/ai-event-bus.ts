import type { AiStreamCallbacks } from './ai-service';

export type AiEventType =
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_complete'
  | 'stream_error'
  | 'stream_abort'
  | 'ai_request_start'
  | 'ai_request_complete'
  | 'ai_request_error';

export interface AiEvent {
  type: AiEventType;
  payload: Record<string, unknown>;
  timestamp: number;
  requestId: string;
}

type AiEventListener = (event: AiEvent) => void;

let requestIdCounter = 0;

export class AiEventBus {
  private listeners: Map<AiEventType, Set<AiEventListener>> = new Map();
  private eventHistory: AiEvent[] = [];
  private maxHistorySize = 100;

  on(eventType: AiEventType, listener: AiEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    return () => this.off(eventType, listener);
  }

  off(eventType: AiEventType, listener: AiEventListener): void {
    this.listeners.get(eventType)?.delete(listener);
  }

  once(eventType: AiEventType, listener: AiEventListener): () => void {
    const unsubscribe = this.on(eventType, (event) => {
      listener(event);
      unsubscribe();
    });
    return unsubscribe;
  }

  emit(eventType: AiEventType, payload: Record<string, unknown> = {}): AiEvent {
    const event: AiEvent = {
      type: eventType,
      payload,
      timestamp: Date.now(),
      requestId: `req-${++requestIdCounter}`,
    };

    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    this.listeners.get(eventType)?.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error('[AiEventBus] listener error:', e);
      }
    });

    return event;
  }

  getHistory(eventType?: AiEventType): AiEvent[] {
    if (eventType) {
      return this.eventHistory.filter((e) => e.type === eventType);
    }
    return [...this.eventHistory];
  }

  getLatestEvent(eventType?: AiEventType): AiEvent | undefined {
    const history = this.getHistory(eventType);
    return history[history.length - 1];
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  toStreamCallbacks(requestId?: string): AiStreamCallbacks {
    const rid = requestId || `req-${++requestIdCounter}`;

    return {
      onChunk: (chunk: string) => {
        this.emit('stream_chunk', { chunk, requestId: rid });
      },
      onComplete: (fullText: string) => {
        this.emit('stream_complete', { fullText, requestId: rid });
      },
      onError: (error: Error) => {
        this.emit('stream_error', { error: error.message, requestId: rid });
      },
      onAbort: () => {
        this.emit('stream_abort', { requestId: rid });
      },
    };
  }
}

export const aiEventBus = new AiEventBus();
