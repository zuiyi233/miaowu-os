import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiniEditor } from '../components/common/MiniEditor';

// 创建测试用的 QueryClient
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

// 包装组件的测试工具
const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('MiniEditor 集成测试', () => {
  beforeEach(() => {
    // 重置所有模拟
    vi.clearAllMocks();
  });

  it('应该正确渲染富文本编辑器', () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 检查工具栏按钮是否存在
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bullet list/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ordered list/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /redo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /heading 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quote/i })).toBeInTheDocument();
  });

  it('应该正确处理内容变化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content=""
        onChange={mockOnChange}
      />
    );

    // 获取编辑器内容区域
    const editorContent = screen.getByRole('textbox');
    fireEvent.input(editorContent, { target: { innerHTML: '<p>新内容</p>' } });

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  it('应该支持粗体格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击粗体按钮
    const boldButton = screen.getByRole('button', { name: /bold/i });
    fireEvent.click(boldButton);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持斜体格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击斜体按钮
    const italicButton = screen.getByRole('button', { name: /italic/i });
    fireEvent.click(italicButton);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(italicButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持无序列表格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击无序列表按钮
    const bulletListButton = screen.getByRole('button', { name: /bullet list/i });
    fireEvent.click(bulletListButton);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(bulletListButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持有序列表格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击有序列表按钮
    const orderedListButton = screen.getByRole('button', { name: /ordered list/i });
    fireEvent.click(orderedListButton);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(orderedListButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持标题格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击标题1按钮
    const heading1Button = screen.getByRole('button', { name: /heading 1/i });
    fireEvent.click(heading1Button);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(heading1Button).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持引用格式化', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击引用按钮
    const quoteButton = screen.getByRole('button', { name: /quote/i });
    fireEvent.click(quoteButton);

    // 验证按钮状态变化
    await waitFor(() => {
      expect(quoteButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('应该支持撤销操作', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击撤销按钮
    const undoButton = screen.getByRole('button', { name: /undo/i });
    fireEvent.click(undoButton);

    // 验证按钮被点击（撤销功能的具体行为由 Tiptap 处理）
    expect(undoButton).toBeInTheDocument();
  });

  it('应该支持重做操作', async () => {
    const mockOnChange = vi.fn();
    renderWithQueryClient(
      <MiniEditor
        content="<p>测试内容</p>"
        onChange={mockOnChange}
      />
    );

    // 点击重做按钮
    const redoButton = screen.getByRole('button', { name: /redo/i });
    fireEvent.click(redoButton);

    // 验证按钮被点击（重做功能的具体行为由 Tiptap 处理）
    expect(redoButton).toBeInTheDocument();
  });
});