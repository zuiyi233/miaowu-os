import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";

interface FloatingToolbarState {
  isVisible: boolean;
  x: number;
  y: number;
  selectedText: string;
  from: number;
  to: number;
}

/**
 * 浮动工具栏 Hook
 * 提供选中文本时显示浮动工具栏的功能
 * 遵循单一职责原则，专注于浮动工具栏的状态管理
 */
export const useFloatingToolbar = (editor: Editor | null) => {
  const [state, setState] = useState<FloatingToolbarState>({
    isVisible: false,
    x: 0,
    y: 0,
    selectedText: "",
    from: 0,
    to: 0,
  });

  // 处理选择更新的逻辑
  const handleSelectionUpdate = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;

    // 如果有选中文本，显示工具栏并更新位置
    if (from !== to) {
      const { view } = editor;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);

      // 计算工具栏位置（选中文本的上方中间）
      const x = (start.left + end.left) / 2;
      const y = start.top - 10; // 在选中文本上方10px

      // 获取选中文本内容
      const selectedText = view.state.doc.textBetween(from, to);

      setState({
        isVisible: true,
        x,
        y,
        selectedText,
        from,
        to,
      });
    } else {
      // 隐藏工具栏
      setState((prev) => ({ ...prev, isVisible: false }));
    }
  }, [editor]);

  // 监听选择变化
  useEffect(() => {
    if (!editor) return;

    // 监听编辑器事务（选择变化）
    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("transaction", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("transaction", handleSelectionUpdate);
    };
  }, [editor, handleSelectionUpdate]);

  // 隐藏工具栏
  const hideToolbar = useCallback(() => {
    setState((prev) => ({ ...prev, isVisible: false }));
  }, []);

  return {
    ...state,
    hideToolbar,
  };
};
