import { create } from 'zustand';

interface AiStreamState {
  isStreaming: boolean;
  latestChunk: string | null;
  seq: number;
  error: string | null;
}

interface AiPanelState {
  activeTab: 'chat' | 'generate' | 'context';
  aiStream: AiStreamState;
  selectedText: string | null;
  contextEntities: string[];

  setActiveTab: (tab: AiPanelState['activeTab']) => void;
  setAiStream: (stream: Partial<AiStreamState>) => void;
  startStreaming: () => void;
  addChunk: (chunk: string) => void;
  stopStreaming: () => void;
  setSelectedText: (text: string | null) => void;
  setContextEntities: (entities: string[]) => void;
  addContextEntity: (entity: string) => void;
  removeContextEntity: (entity: string) => void;
}

export const useAiPanelStore = create<AiPanelState>()((set) => ({
  activeTab: 'chat',
  aiStream: {
    isStreaming: false,
    latestChunk: null,
    seq: 0,
    error: null,
  },
  selectedText: null,
  contextEntities: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setAiStream: (stream) => set((state) => ({
    aiStream: { ...state.aiStream, ...stream },
  })),
  startStreaming: () => set({
    aiStream: { isStreaming: true, latestChunk: null, seq: 0, error: null },
  }),
  addChunk: (chunk) => set((state) => ({
    aiStream: {
      ...state.aiStream,
      latestChunk: chunk,
      seq: state.aiStream.seq + 1,
    },
  })),
  stopStreaming: () => set((state) => ({
    aiStream: {
      ...state.aiStream,
      isStreaming: false,
      latestChunk: null,
    },
  })),
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
