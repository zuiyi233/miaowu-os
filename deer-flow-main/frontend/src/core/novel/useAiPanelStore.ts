import { create } from 'zustand';

interface AiStreamState {
  isStreaming: boolean;
  latestChunk: string | null;
  seq: number;
  error: string | null;
}

const DEFAULT_AI_STREAM: AiStreamState = {
  isStreaming: false,
  latestChunk: null,
  seq: 0,
  error: null,
};

interface AiPanelState {
  activeTab: 'chat' | 'generate' | 'context' | 'analysis';
  aiStream: AiStreamState;
  streams: Record<string, AiStreamState>;
  activeRequestId: string | null;
  selectedText: string | null;
  contextEntities: string[];

  setActiveTab: (tab: AiPanelState['activeTab']) => void;
  setAiStream: (stream: Partial<AiStreamState>) => void;
  startStreaming: (requestId?: string) => void;
  addChunk: (requestIdOrChunk: string, chunk?: string) => void;
  stopStreaming: (requestId?: string) => void;
  setError: (requestIdOrError: string | null, error?: string | null) => void;
  clearStream: (requestId: string) => void;
  setSelectedText: (text: string | null) => void;
  setContextEntities: (entities: string[]) => void;
  addContextEntity: (entity: string) => void;
  removeContextEntity: (entity: string) => void;
}

function getRequestId(state: AiPanelState, requestId?: string | null): string {
  return requestId || state.activeRequestId || 'default';
}

function withUpdatedActiveStream(
  state: AiPanelState,
  requestId: string,
  stream: AiStreamState,
): Pick<AiPanelState, 'streams' | 'activeRequestId' | 'aiStream'> {
  return {
    streams: {
      ...state.streams,
      [requestId]: stream,
    },
    activeRequestId: requestId,
    aiStream: stream,
  };
}

export const selectActiveAiStream = (state: AiPanelState) => state.aiStream;

export const useActiveAiStream = () => useAiPanelStore(selectActiveAiStream);

export const useAiPanelStore = create<AiPanelState>()((set) => ({
  activeTab: 'chat',
  aiStream: DEFAULT_AI_STREAM,
  streams: {},
  activeRequestId: null,
  selectedText: null,
  contextEntities: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setAiStream: (stream) => set((state) => {
    const requestId = getRequestId(state);
    const nextStream = { ...(state.streams[requestId] ?? state.aiStream), ...stream };
    return withUpdatedActiveStream(state, requestId, nextStream);
  }),
  startStreaming: (requestId) => set((state) => {
    const rid = getRequestId(state, requestId);
    return withUpdatedActiveStream(state, rid, {
      isStreaming: true,
      latestChunk: null,
      seq: 0,
      error: null,
    });
  }),
  addChunk: (requestIdOrChunk, chunk) => set((state) => {
    const hasExplicitRequestId = chunk !== undefined;
    const requestId = hasExplicitRequestId
      ? requestIdOrChunk
      : getRequestId(state);
    const nextChunk = hasExplicitRequestId ? chunk : requestIdOrChunk;
    if (!nextChunk) {
      return state;
    }
    const current = state.streams[requestId] ?? state.aiStream ?? DEFAULT_AI_STREAM;
    return withUpdatedActiveStream(state, requestId, {
      ...current,
      latestChunk: nextChunk,
      seq: current.seq + 1,
    });
  }),
  stopStreaming: (requestId) => set((state) => {
    const rid = getRequestId(state, requestId);
    const current = state.streams[rid] ?? state.aiStream ?? DEFAULT_AI_STREAM;
    return withUpdatedActiveStream(state, rid, {
      ...current,
      isStreaming: false,
      latestChunk: null,
    });
  }),
  setError: (requestIdOrError, error) => set((state) => {
    const hasExplicitRequestId = error !== undefined;
    const requestId = hasExplicitRequestId
      ? (requestIdOrError || getRequestId(state))
      : getRequestId(state);
    const nextError = hasExplicitRequestId ? error : requestIdOrError;
    const current = state.streams[requestId] ?? state.aiStream ?? DEFAULT_AI_STREAM;
    return withUpdatedActiveStream(state, requestId, {
      ...current,
      error: nextError,
      isStreaming: false,
    });
  }),
  clearStream: (requestId) => set((state) => {
    const { [requestId]: _removed, ...streams } = state.streams;
    const activeRequestId = state.activeRequestId === requestId ? null : state.activeRequestId;
    const aiStream = activeRequestId ? (streams[activeRequestId] ?? DEFAULT_AI_STREAM) : DEFAULT_AI_STREAM;
    return { streams, activeRequestId, aiStream };
  }),
  setSelectedText: (text) => set({ selectedText: text }),
  setContextEntities: (entities) => set({ contextEntities: entities }),
  addContextEntity: (entity) => set((state) => ({
    contextEntities: state.contextEntities.includes(entity)
      ? state.contextEntities
      : [...state.contextEntities, entity],
  })),
  removeContextEntity: (entity) => set((state) => ({
    contextEntities: state.contextEntities.filter((e) => e !== entity),
  })),
}));
