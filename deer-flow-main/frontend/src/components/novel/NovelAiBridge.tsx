'use client';

import { useEffect } from 'react';

import { aiEventBus } from '@/core/novel/ai-event-bus';
import { useAiPanelStore } from '@/core/novel/useAiPanelStore';

export function NovelAiBridge() {
  const startStreaming = useAiPanelStore((s) => s.startStreaming);
  const addChunk = useAiPanelStore((s) => s.addChunk);
  const stopStreaming = useAiPanelStore((s) => s.stopStreaming);
  const setError = useAiPanelStore((s) => s.setError);

  useEffect(() => {
    const unsubscribeStart = aiEventBus.on('stream_start', (event) => {
      startStreaming(event.requestId);
    });
    const unsubscribeChunk = aiEventBus.on('stream_chunk', (event) => {
      const chunk = event.payload.chunk;
      if (typeof chunk === 'string' && chunk) {
        addChunk(event.requestId, chunk);
      }
    });
    const unsubscribeComplete = aiEventBus.on('stream_complete', (event) => {
      stopStreaming(event.requestId);
    });
    const unsubscribeError = aiEventBus.on('stream_error', (event) => {
      const error = event.payload.error;
      setError(event.requestId, typeof error === 'string' && error ? error : 'AI 请求失败');
    });
    const unsubscribeAbort = aiEventBus.on('stream_abort', (event) => {
      stopStreaming(event.requestId);
    });

    return () => {
      unsubscribeStart();
      unsubscribeChunk();
      unsubscribeComplete();
      unsubscribeError();
      unsubscribeAbort();
    };
  }, [addChunk, setError, startStreaming, stopStreaming]);

  return null;
}
