import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach } from 'vitest';
import { SettingDetail } from '../components/SettingDetail';
import { CharacterDetail } from '../components/CharacterDetail';
import { FactionDetail } from '../components/FactionDetail';
import { MiniEditor } from '../components/common/MiniEditor';
import type { Setting, Character, Faction } from '../types';

// 创建测试用的 QueryClient
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

// 测试数据
const mockSetting: Setting = {
  id: '1',
  name: '测试场景',
  description: '<p>这是一个<strong>测试</strong>场景的描述</p>',
  novelId: '1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCharacter: Character = {
  id: '1',
  name: '测试角色',
  description: '<p>这是一个<em>测试</em>角色的描述</p>',
  novelId: '1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockFaction: Faction = {
  id: '1',
  name: '测试势力',
  description: '<blockquote>这是一个测试势力的描述</blockquote>',
  novelId: '1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// 包装组件的测试工具
const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('统一编辑体验测试', () => {
  beforeEach(() => {
    // 重置所有模拟
    vi.clearAllMocks();
  });

  describe('MiniEditor 组件测试', () => {
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
        expect(mockOnChange).toHaveBeenCalledWith('<p>新内容</p>');
      });
    });
  });

  describe('SettingDetail 组件测试', () => {
    it('应该正确渲染场景详情', () => {
      renderWithQueryClient(
        <SettingDetail
          setting={mockSetting}
          onClose={vi.fn()}
        />
      );

      // 检查场景名称和描述是否正确渲染
      expect(screen.getByText('测试场景')).toBeInTheDocument();
      expect(screen.getByText(/这是一个.*测试.*场景的描述/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
    });

    it('应该能够切换到编辑模式', async () => {
      renderWithQueryClient(
        <SettingDetail
          setting={mockSetting}
          onClose={vi.fn()}
        />
      );

      // 点击编辑按钮
      const editButton = screen.getByRole('button', { name: /编辑/i });
      fireEvent.click(editButton);

      // 检查是否切换到编辑模式
      await waitFor(() => {
        expect(screen.getByText(/编辑场景: 测试场景/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('测试场景')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /保存更改/i })).toBeInTheDocument();
      });
    });

    it('应该能够取消编辑模式', async () => {
      renderWithQueryClient(
        <SettingDetail
          setting={mockSetting}
          onClose={vi.fn()}
        />
      );

      // 点击编辑按钮
      const editButton = screen.getByRole('button', { name: /编辑/i });
      fireEvent.click(editButton);

      // 等待编辑模式加载
      await waitFor(() => {
        expect(screen.getByText(/编辑场景: 测试场景/i)).toBeInTheDocument();
      });

      // 点击取消按钮
      const cancelButton = screen.getByRole('button', { name: /×/i });
      fireEvent.click(cancelButton);

      // 检查是否返回查看模式
      await waitFor(() => {
        expect(screen.getByText('测试场景')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      });
    });
  });

  describe('CharacterDetail 组件测试', () => {
    it('应该正确渲染角色详情', () => {
      renderWithQueryClient(
        <CharacterDetail
          character={mockCharacter}
          onClose={vi.fn()}
        />
      );

      // 检查角色名称和描述是否正确渲染
      expect(screen.getByText('测试角色')).toBeInTheDocument();
      expect(screen.getByText(/这是一个.*测试.*角色的描述/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
    });

    it('应该能够切换到编辑模式', async () => {
      renderWithQueryClient(
        <CharacterDetail
          character={mockCharacter}
          onClose={vi.fn()}
        />
      );

      // 点击编辑按钮
      const editButton = screen.getByRole('button', { name: /编辑/i });
      fireEvent.click(editButton);

      // 检查是否切换到编辑模式
      await waitFor(() => {
        expect(screen.getByText(/编辑角色: 测试角色/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('测试角色')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /保存更改/i })).toBeInTheDocument();
      });
    });
  });

  describe('FactionDetail 组件测试', () => {
    it('应该正确渲染势力详情', () => {
      renderWithQueryClient(
        <FactionDetail
          faction={mockFaction}
          onClose={vi.fn()}
        />
      );

      // 检查势力名称和描述是否正确渲染
      expect(screen.getByText('测试势力')).toBeInTheDocument();
      expect(screen.getByText(/这是一个测试势力的描述/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
    });

    it('应该能够切换到编辑模式', async () => {
      renderWithQueryClient(
        <FactionDetail
          faction={mockFaction}
          onClose={vi.fn()}
        />
      );

      // 点击编辑按钮
      const editButton = screen.getByRole('button', { name: /编辑/i });
      fireEvent.click(editButton);

      // 检查是否切换到编辑模式
      await waitFor(() => {
        expect(screen.getByText(/编辑势力: 测试势力/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('测试势力')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /保存更改/i })).toBeInTheDocument();
      });
    });
  });

  describe('富文本渲染测试', () => {
    it('应该正确渲染各种富文本格式', () => {
      const richTextSetting: Setting = {
        ...mockSetting,
        description: `
          <h1>标题1</h1>
          <h2>标题2</h2>
          <h3>标题3</h3>
          <p>普通文本 <strong>粗体</strong> <em>斜体</em></p>
          <ul><li>无序列表项</li></ul>
          <ol><li>有序列表项</li></ol>
          <blockquote>引用文本</blockquote>
        `,
      };

      renderWithQueryClient(
        <SettingDetail
          setting={richTextSetting}
          onClose={vi.fn()}
        />
      );

      // 检查各种富文本元素是否正确渲染
      expect(screen.getByText('标题1')).toBeInTheDocument();
      expect(screen.getByText('标题2')).toBeInTheDocument();
      expect(screen.getByText('标题3')).toBeInTheDocument();
      expect(screen.getByText(/普通文本.*粗体.*斜体/)).toBeInTheDocument();
      expect(screen.getByText('无序列表项')).toBeInTheDocument();
      expect(screen.getByText('有序列表项')).toBeInTheDocument();
      expect(screen.getByText('引用文本')).toBeInTheDocument();
    });
  });
});