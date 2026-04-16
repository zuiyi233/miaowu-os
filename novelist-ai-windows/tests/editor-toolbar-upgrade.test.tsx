import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorToolbar } from '../components/EditorToolbar';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { Editor } from '@tiptap/react';

// Mock the hooks and modules
vi.mock('../lib/react-query/db-queries', () => ({
  useNovelQuery: () => ({
    data: {
      chapters: [
        { id: '1', title: 'Test Chapter', content: '<p>Test</p>' }
      ]
    }
  })
}));

vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({
    activeChapterId: '1'
  })
}));

vi.mock('../components/HistorySheet', () => ({
  HistorySheet: ({ chapterId, chapterTitle }: any) => (
    <div data-testid="history-sheet">{chapterTitle}</div>
  )
}));

describe('EditorToolbar Upgrade Tests', () => {
  let mockEditor: Editor;

  beforeEach(() => {
    mockEditor = useEditor({
      extensions: [StarterKit],
      content: '<p>Test content</p>',
    }) as Editor;
  });

  it('应该渲染所有升级后的工具栏按钮', () => {
    render(
      <EditorToolbar
        editor={mockEditor}
        className="test-class"
      />
    );

    // 验证历史操作组
    expect(screen.getByLabelText('Undo')).toBeInTheDocument();
    expect(screen.getByLabelText('Redo')).toBeInTheDocument();

    // 验证基础格式组
    expect(screen.getByLabelText('Bold')).toBeInTheDocument();
    expect(screen.getByLabelText('Italic')).toBeInTheDocument();
    expect(screen.getByLabelText('Strikethrough')).toBeInTheDocument();

    // 验证标题组
    expect(screen.getByLabelText('H1')).toBeInTheDocument();
    expect(screen.getByLabelText('H2')).toBeInTheDocument();
    expect(screen.getByLabelText('H3')).toBeInTheDocument();

    // 验证列表与引用组
    expect(screen.getByLabelText('Bullet List')).toBeInTheDocument();
    expect(screen.getByLabelText('Ordered List')).toBeInTheDocument();
    expect(screen.getByLabelText('Blockquote')).toBeInTheDocument();
  });

  it('应该显示正确的工具提示', () => {
    render(<EditorToolbar editor={mockEditor} />);

    // 验证工具提示文本
    expect(screen.getByTitle('撤销 (Ctrl+Z)')).toBeInTheDocument();
    expect(screen.getByTitle('重做 (Ctrl+Y)')).toBeInTheDocument();
    expect(screen.getByTitle('加粗 (Ctrl+B)')).toBeInTheDocument();
    expect(screen.getByTitle('斜体 (Ctrl+I)')).toBeInTheDocument();
    expect(screen.getByTitle('删除线')).toBeInTheDocument();
    expect(screen.getByTitle('一级标题')).toBeInTheDocument();
    expect(screen.getByTitle('二级标题')).toBeInTheDocument();
    expect(screen.getByTitle('三级标题')).toBeInTheDocument();
    expect(screen.getByTitle('无序列表')).toBeInTheDocument();
    expect(screen.getByTitle('有序列表')).toBeInTheDocument();
    expect(screen.getByTitle('引用段落')).toBeInTheDocument();
  });

  it('应该正确禁用撤销/重做按钮', () => {
    render(<EditorToolbar editor={mockEditor} />);

    const undoButton = screen.getByLabelText('Undo');
    const redoButton = screen.getByLabelText('Redo');

    // 当没有历史记录时，按钮应该被禁用
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
  });

  it('应该应用正确的样式类', () => {
    const { container } = render(
      <EditorToolbar
        editor={mockEditor}
        className="test-class"
      />
    );

    const toolbar = container.querySelector('div');
    expect(toolbar).toHaveClass(
      'border',
      'bg-card/95',
      'backdrop-blur',
      'rounded-lg',
      'shadow-sm',
      'p-1.5',
      'flex',
      'gap-1',
      'items-center',
      'flex-wrap',
      'sticky',
      'top-2',
      'z-40',
      'mx-auto',
      'max-w-fit',
      'test-class'
    );
  });
});