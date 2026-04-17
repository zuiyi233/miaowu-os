import { create } from "zustand";

import type { OutlineNode } from "./schemas";

interface OutlineState {
  tree: OutlineNode[];
  isGenerating: boolean;
  selectedNodeId: string | null;

  setTree: (nodes: OutlineNode[]) => void;
  updateNode: (id: string, data: Partial<OutlineNode>) => void;
  updateNodeStatus: (id: string, status: "idle" | "generating" | "error") => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  addNode: (node: OutlineNode, parentId?: string) => void;
  removeNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  setIsGenerating: (generating: boolean) => void;
  clearTree: () => void;
  moveNode: (activeId: string, overId: string) => void;
  updateNodeIds: (idMap: Record<string, string>) => void;
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const newArray = [...array];
  const [item] = newArray.splice(from, 1);
  newArray.splice(to, 0, item!);
  return newArray;
}

export const useOutlineStore = create<OutlineState>()((set, _get) => ({
  tree: [],
  isGenerating: false,
  selectedNodeId: null,

  setTree: (nodes) => set({ tree: nodes }),

  updateNode: (id, data) => {
    const updateNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, ...data };
        }
        if (node.children) {
          return { ...node, children: updateNodeRecursive(node.children) };
        }
        return node;
      });
    };
    set((state) => ({ tree: updateNodeRecursive(state.tree) }));
  },

  updateNodeStatus: (id, status) => {
    const updateStatusRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, status };
        }
        if (node.children) {
          return { ...node, children: updateStatusRecursive(node.children) };
        }
        return node;
      });
    };
    set((state) => ({ tree: updateStatusRecursive(state.tree) }));
  },

  toggleSelection: (id) => {
    const toggleNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, isSelected: !node.isSelected };
        }
        if (node.children) {
          return { ...node, children: toggleNodeRecursive(node.children) };
        }
        return node;
      });
    };
    set((state) => ({ tree: toggleNodeRecursive(state.tree) }));
  },

  selectAll: () => {
    const selectAllRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => ({
        ...node,
        isSelected: true,
        children: node.children ? selectAllRecursive(node.children) : undefined,
      }));
    };
    set((state) => ({ tree: selectAllRecursive(state.tree) }));
  },

  deselectAll: () => {
    const deselectAllRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => ({
        ...node,
        isSelected: false,
        children: node.children ? deselectAllRecursive(node.children) : undefined,
      }));
    };
    set((state) => ({ tree: deselectAllRecursive(state.tree) }));
  },

  addNode: (node, parentId) => {
    if (!parentId) {
      set((state) => ({ tree: [...state.tree, node] }));
    } else {
      const addNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
        return nodes.map((n) => {
          if (n.id === parentId) {
            return { ...n, children: [...(n.children || []), node] };
          }
          if (n.children) {
            return { ...n, children: addNodeRecursive(n.children) };
          }
          return n;
        });
      };
      set((state) => ({ tree: addNodeRecursive(state.tree) }));
    }
  },

  removeNode: (id) => {
    const removeNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes
        .filter((node) => node.id !== id)
        .map((node) => ({
          ...node,
          children: node.children ? removeNodeRecursive(node.children) : undefined,
        }));
    };
    set((state) => ({ tree: removeNodeRecursive(state.tree) }));
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  clearTree: () => set({ tree: [], selectedNodeId: null }),

  moveNode: (activeId, overId) => {
    set((state) => {
      const deepClone = JSON.parse(JSON.stringify(state.tree));

      const activeIndexRoot = deepClone.findIndex((n: OutlineNode) => n.id === activeId);
      const overIndexRoot = deepClone.findIndex((n: OutlineNode) => n.id === overId);

      if (activeIndexRoot !== -1 && overIndexRoot !== -1) {
        return { tree: arrayMove(deepClone, activeIndexRoot, overIndexRoot) };
      }

      for (const vol of deepClone) {
        if (vol.children) {
          const activeIndex = vol.children.findIndex((n: OutlineNode) => n.id === activeId);
          const overIndex = vol.children.findIndex((n: OutlineNode) => n.id === overId);

          if (activeIndex !== -1 && overIndex !== -1) {
            vol.children = arrayMove(vol.children, activeIndex, overIndex);
            return { tree: deepClone };
          }
        }
      }

      return { tree: state.tree };
    });
  },

  updateNodeIds: (idMap) => {
    const updateIdsRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        const updatedNode = { ...node };
        const mappedId = idMap[node.id];
        if (mappedId !== undefined) {
          updatedNode.id = mappedId;
        }
        if (node.children) {
          updatedNode.children = updateIdsRecursive(node.children);
        }
        return updatedNode;
      });
    };
    set((state) => ({ tree: updateIdsRecursive(state.tree) }));
  },
}));
