/**
 * EditorToolbar 升级功能测试
 * 
 * 验证升级后的编辑器工具栏功能是否正常工作
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock the hooks and modules
vi.mock("../lib/react-query/db-queries", () => ({
  useNovelQuery: () => ({
    data: {
      chapters: [
        { id: "1", title: "Test Chapter", content: "<p>Test</p>" }
      ]
    }
  })
}));

vi.mock("../stores/useUiStore", () => ({
  useUiStore: () => ({
    activeChapterId: "1"
  })
}));

vi.mock("../components/HistorySheet", () => ({
  HistorySheet: ({ chapterId, chapterTitle }: any) => 
    React.createElement("div", { "data-testid": "history-sheet" }, chapterTitle)
}));

// Mock Tiptap editor
const mockEditor = {
  isActive: vi.fn((feature: string) => false),
  can: vi.fn(() => ({ undo: () => false, redo: () => false })),
  chain: vi.fn(() => ({
    focus: vi.fn(() => ({
      undo: vi.fn(() => ({ run: vi.fn() })),
      redo: vi.fn(() => ({ run: vi.fn() })),
      toggleBold: vi.fn(() => ({ run: vi.fn() })),
      toggleItalic: vi.fn(() => ({ run: vi.fn() })),
      toggleStrike: vi.fn(() => ({ run: vi.fn() })),
      toggleHeading: vi.fn(() => ({ run: vi.fn() })),
      toggleBulletList: vi.fn(() => ({ run: vi.fn() })),
      toggleOrderedList: vi.fn(() => ({ run: vi.fn() })),
      toggleBlockquote: vi.fn(() => ({ run: vi.fn() }))
    }))
  }))
};

describe("EditorToolbar 升级功能测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该渲染所有升级后的工具栏按钮", async () => {
    // 动态导入组件
    const { EditorToolbar } = await import("../components/EditorToolbar");
    
    render(
      React.createElement(EditorToolbar, {
        editor: mockEditor as any,
        className: "test-class"
      })
    );

    // 验证历史操作组
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
    expect(screen.getByLabelText("Redo")).toBeInTheDocument();

    // 验证基础格式组
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
    expect(screen.getByLabelText("Strikethrough")).toBeInTheDocument();

    // 验证标题组
    expect(screen.getByLabelText("H1")).toBeInTheDocument();
    expect(screen.getByLabelText("H2")).toBeInTheDocument();
    expect(screen.getByLabelText("H3")).toBeInTheDocument();

    // 验证列表与引用组
    expect(screen.getByLabelText("Bullet List")).toBeInTheDocument();
    expect(screen.getByLabelText("Ordered List")).toBeInTheDocument();
    expect(screen.getByLabelText("Blockquote")).toBeInTheDocument();
  });

  it("应该显示正确的工具提示", async () => {
    const { EditorToolbar } = await import("../components/EditorToolbar");
    
    render(
      React.createElement(EditorToolbar, {
        editor: mockEditor as any
      })
    );

    // 验证工具提示文本
    expect(screen.getByTitle("撤销 (Ctrl+Z)")).toBeInTheDocument();
    expect(screen.getByTitle("重做 (Ctrl+Y)")).toBeInTheDocument();
    expect(screen.getByTitle("加粗 (Ctrl+B)")).toBeInTheDocument();
    expect(screen.getByTitle("斜体 (Ctrl+I)")).toBeInTheDocument();
    expect(screen.getByTitle("删除线")).toBeInTheDocument();
    expect(screen.getByTitle("一级标题")).toBeInTheDocument();
    expect(screen.getByTitle("二级标题")).toBeInTheDocument();
    expect(screen.getByTitle("三级标题")).toBeInTheDocument();
    expect(screen.getByTitle("无序列表")).toBeInTheDocument();
    expect(screen.getByTitle("有序列表")).toBeInTheDocument();
    expect(screen.getByTitle("引用段落")).toBeInTheDocument();
  });

  it("应该正确禁用撤销/重做按钮", async () => {
    const { EditorToolbar } = await import("../components/EditorToolbar");
    
    render(
      React.createElement(EditorToolbar, {
        editor: mockEditor as any
      })
    );

    const undoButton = screen.getByLabelText("Undo");
    const redoButton = screen.getByLabelText("Redo");

    // 当没有历史记录时，按钮应该被禁用
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
  });

  it("应该应用正确的样式类", async () => {
    const { EditorToolbar } = await import("../components/EditorToolbar");
    
    const { container } = render(
      React.createElement(EditorToolbar, {
        editor: mockEditor as any,
        className: "test-class"
      })
    );

    const toolbar = container.querySelector("div");
    expect(toolbar).toHaveClass(
      "border",
      "bg-card/95",
      "backdrop-blur",
      "rounded-lg",
      "shadow-sm",
      "p-1.5",
      "flex",
      "gap-1",
      "items-center",
      "flex-wrap",
      "sticky",
      "top-2",
      "z-40",
      "mx-auto",
      "max-w-fit",
      "test-class"
    );
  });

  it("应该渲染历史记录组件", async () => {
    const { EditorToolbar } = await import("../components/EditorToolbar");
    
    render(
      React.createElement(EditorToolbar, {
        editor: mockEditor as any
      })
    );

    // 验证历史记录组件存在
    expect(screen.getByTestId("history-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("history-sheet")).toHaveTextContent("Test Chapter");
  });
});