import { create } from "zustand";
import type { OutlineNode } from "../types";
import { logger } from "../lib/logging";
import { arrayMove } from "@dnd-kit/sortable";

/**
 * 大纲状态接口
 * 遵循单一职责原则，仅管理大纲视图的临时状态
 */
interface OutlineState {
  // 大纲树状结构
  tree: OutlineNode[];

  // 生成状态
  isGenerating: boolean;

  // 当前选中的节点ID（用于编辑）
  selectedNodeId: string | null;

  // Actions
  setTree: (nodes: OutlineNode[]) => void;
  updateNode: (id: string, data: Partial<OutlineNode>) => void;
  updateNodeStatus: (
    id: string,
    status: "idle" | "generating" | "error"
  ) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  addNode: (node: OutlineNode, parentId?: string) => void;
  removeNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  setIsGenerating: (generating: boolean) => void;
  clearTree: () => void;
  moveNode: (activeId: string, overId: string) => void;
  // 🆕 新增：ID 映射更新方法
  updateNodeIds: (idMap: Record<string, string>) => void;
}

// 定义日志上下文
const STORE_CONTEXT = "OutlineStore";

/**
 * 大纲状态管理器
 * 使用 Zustand 进行纯大纲状态管理
 * 遵循单一职责原则，仅负责大纲状态管理，不涉及数据持久化
 */
export const useOutlineStore = create<OutlineState>((set, get) => ({
  // 初始状态
  tree: [],
  isGenerating: false,
  selectedNodeId: null,

  // Actions
  setTree: (nodes) => {
    logger.info(STORE_CONTEXT, "Action: setTree", { nodeCount: nodes.length });
    set({ tree: nodes });
  },

  updateNode: (id, data) => {
    logger.info(STORE_CONTEXT, "Action: updateNode", { id, data });

    const updateNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, ...data };
        }
        if (node.children) {
          return {
            ...node,
            children: updateNodeRecursive(node.children),
          };
        }
        return node;
      });
    };

    set((state) => ({
      tree: updateNodeRecursive(state.tree),
    }));
  },

  updateNodeStatus: (id, status) => {
    logger.info(STORE_CONTEXT, "Action: updateNodeStatus", { id, status });

    const updateStatusRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, status };
        }
        if (node.children) {
          return {
            ...node,
            children: updateStatusRecursive(node.children),
          };
        }
        return node;
      });
    };

    set((state) => ({
      tree: updateStatusRecursive(state.tree),
    }));
  },

  toggleSelection: (id) => {
    logger.info(STORE_CONTEXT, "Action: toggleSelection", { id });

    const toggleNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, isSelected: !node.isSelected };
        }
        if (node.children) {
          return {
            ...node,
            children: toggleNodeRecursive(node.children),
          };
        }
        return node;
      });
    };

    set((state) => ({
      tree: toggleNodeRecursive(state.tree),
    }));
  },

  selectAll: () => {
    logger.info(STORE_CONTEXT, "Action: selectAll");

    const selectAllRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => ({
        ...node,
        isSelected: true,
        children: node.children ? selectAllRecursive(node.children) : undefined,
      }));
    };

    set((state) => ({
      tree: selectAllRecursive(state.tree),
    }));
  },

  deselectAll: () => {
    logger.info(STORE_CONTEXT, "Action: deselectAll");

    const deselectAllRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => ({
        ...node,
        isSelected: false,
        children: node.children
          ? deselectAllRecursive(node.children)
          : undefined,
      }));
    };

    set((state) => ({
      tree: deselectAllRecursive(state.tree),
    }));
  },

  addNode: (node, parentId) => {
    logger.info(STORE_CONTEXT, "Action: addNode", { node, parentId });

    if (!parentId) {
      // 添加到根级别
      set((state) => ({
        tree: [...state.tree, node],
      }));
    } else {
      // 添加到指定父节点
      const addNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
        return nodes.map((n) => {
          if (n.id === parentId) {
            return {
              ...n,
              children: [...(n.children || []), node],
            };
          }
          if (n.children) {
            return {
              ...n,
              children: addNodeRecursive(n.children),
            };
          }
          return n;
        });
      };

      set((state) => ({
        tree: addNodeRecursive(state.tree),
      }));
    }
  },

  removeNode: (id) => {
    logger.info(STORE_CONTEXT, "Action: removeNode", { id });

    const removeNodeRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes
        .filter((node) => node.id !== id)
        .map((node) => ({
          ...node,
          children: node.children
            ? removeNodeRecursive(node.children)
            : undefined,
        }));
    };

    set((state) => ({
      tree: removeNodeRecursive(state.tree),
    }));
  },

  setSelectedNode: (id) => {
    logger.info(STORE_CONTEXT, "Action: setSelectedNode", { id });
    set({ selectedNodeId: id });
  },

  setIsGenerating: (generating) => {
    logger.info(STORE_CONTEXT, "Action: setIsGenerating", { generating });
    set({ isGenerating: generating });
  },

  clearTree: () => {
    logger.info(STORE_CONTEXT, "Action: clearTree");
    set({
      tree: [],
      selectedNodeId: null,
    });
  },

  moveNode: (activeId, overId) => {
    logger.info(STORE_CONTEXT, "Action: moveNode", { activeId, overId });

    set((state) => {
      const deepClone = JSON.parse(JSON.stringify(state.tree));

      // 1. 尝试在根节点查找 (Volume 层级移动)
      const activeIndexRoot = deepClone.findIndex(
        (n: OutlineNode) => n.id === activeId
      );
      const overIndexRoot = deepClone.findIndex(
        (n: OutlineNode) => n.id === overId
      );

      if (activeIndexRoot !== -1 && overIndexRoot !== -1) {
        return { tree: arrayMove(deepClone, activeIndexRoot, overIndexRoot) };
      }

      // 2. 尝试在子节点查找 (Chapter 层级移动)
      // 遍历所有 Volume
      for (const vol of deepClone) {
        if (vol.children) {
          const activeIndex = vol.children.findIndex(
            (n: OutlineNode) => n.id === activeId
          );
          const overIndex = vol.children.findIndex(
            (n: OutlineNode) => n.id === overId
          );

          if (activeIndex !== -1 && overIndex !== -1) {
            // 在同一个 Volume 内移动 Chapter
            vol.children = arrayMove(vol.children, activeIndex, overIndex);
            return { tree: deepClone };
          }
        }
      }

      return { tree: state.tree }; // 如果没找到或跨层级移动，暂不处理
    });
  },

  // 🆕 新增：ID 映射更新方法
  // 用于将 temp- ID 替换为真实的 UUID
  updateNodeIds: (idMap) => {
    logger.info(STORE_CONTEXT, "Action: updateNodeIds", {
      mappingCount: Object.keys(idMap).length,
    });

    const updateIdsRecursive = (nodes: OutlineNode[]): OutlineNode[] => {
      return nodes.map((node) => {
        const updatedNode = { ...node };

        // 替换当前节点的 ID
        if (idMap[node.id]) {
          updatedNode.id = idMap[node.id];
        }

        // 递归处理子节点
        if (node.children) {
          updatedNode.children = updateIdsRecursive(node.children);
        }

        return updatedNode;
      });
    };

    set((state) => ({
      tree: updateIdsRecursive(state.tree),
    }));
  },
}));
