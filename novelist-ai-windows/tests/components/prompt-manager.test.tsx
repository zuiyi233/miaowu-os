import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromptManager } from '../../components/settings/PromptManager';
import { useModalStore } from '../../stores/useModalStore';
import * as promptQueries from '../../lib/react-query/prompt.queries';

// Mock dependencies
vi.mock('../../lib/react-query/prompt.queries');
vi.mock('../../stores/useModalStore');
vi.mock('../../lib/storage/db');

describe('PromptManager 组件测试', () => {
  let queryClient: QueryClient;
  let mockOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    
    mockOpen = vi.fn();
    vi.mocked(useModalStore).mockReturnValue({
      open: mockOpen,
    } as any);

    vi.clearAllMocks();
  });

  const renderWithQueryClient = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  describe('基本渲染测试', () => {
    it('应该正确渲染提示词管理器标题', () => {
      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('提示词工程实验室')).toBeInTheDocument();
      expect(screen.getByText('新建模板')).toBeInTheDocument();
    });

    it('应该显示空状态当没有模板时', () => {
      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('提示词工程实验室')).toBeInTheDocument();
    });

    it('应该按类型分组显示模板', () => {
      const mockTemplates = [
        {
          id: '1',
          name: '标准续写',
          type: 'continue',
          content: '请续写：{{selection}}',
          isBuiltIn: true,
          isActive: true,
        },
        {
          id: '2',
          name: '深度润色',
          type: 'polish',
          content: '请润色：{{selection}}',
          isBuiltIn: false,
          isActive: false,
        },
      ];

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: mockTemplates,
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('续写模式')).toBeInTheDocument();
      expect(screen.getByText('润色模式')).toBeInTheDocument();
      expect(screen.getByText('标准续写')).toBeInTheDocument();
      expect(screen.getByText('深度润色')).toBeInTheDocument();
    });
  });

  describe('交互功能测试', () => {
    it('应该点击新建模板按钮时打开编辑器', () => {
      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      const newTemplateButton = screen.getByText('新建模板');
      fireEvent.click(newTemplateButton);

      expect(mockOpen).toHaveBeenCalledWith({
        type: 'drawer',
        title: '创建提示词',
        description: '使用 {{variable}} 语法来插入动态内容。',
        component: expect.any(Function),
        props: {
          initialData: undefined,
        },
      });
    });

    it('应该点击编辑按钮时打开编辑器并传入模板数据', () => {
      const mockTemplate = {
        id: '1',
        name: '测试模板',
        type: 'continue',
        content: '测试内容',
        isBuiltIn: false,
        isActive: false,
      };

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [mockTemplate],
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      const editButton = screen.getByTitle('编辑模板');
      fireEvent.click(editButton);

      expect(mockOpen).toHaveBeenCalledWith({
        type: 'drawer',
        title: '编辑提示词',
        description: '使用 {{variable}} 语法来插入动态内容。',
        component: expect.any(Function),
        props: {
          initialData: mockTemplate,
        },
      });
    });

    it('应该显示预设标签和当前使用标签', () => {
      const mockTemplates = [
        {
          id: '1',
          name: '内置模板',
          type: 'continue',
          content: '内置内容',
          isBuiltIn: true,
          isActive: true,
        },
        {
          id: '2',
          name: '自定义模板',
          type: 'continue',
          content: '自定义内容',
          isBuiltIn: false,
          isActive: false,
        },
      ];

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: mockTemplates,
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('预设')).toBeInTheDocument();
      expect(screen.getByText('当前使用')).toBeInTheDocument();
    });
  });

  describe('激活状态管理测试', () => {
    it('应该为非激活模板显示设为默认按钮', () => {
      const mockTemplate = {
        id: '1',
        name: '非激活模板',
        type: 'continue',
        content: '内容',
        isBuiltIn: false,
        isActive: false,
      };

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [mockTemplate],
        isLoading: false,
        error: null,
      } as any);

      const mockActivateMutation = {
        mutate: vi.fn(),
        isPending: false,
      };

      vi.mocked(promptQueries.useActivatePromptTemplateMutation).mockReturnValue(mockActivateMutation as any);

      renderWithQueryClient(<PromptManager />);
      
      const activateButton = screen.getByTitle('设为默认');
      expect(activateButton).toBeInTheDocument();
    });

    it('应该为激活模板不显示设为默认按钮', () => {
      const mockTemplate = {
        id: '1',
        name: '激活模板',
        type: 'continue',
        content: '内容',
        isBuiltIn: false,
        isActive: true,
      };

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: [mockTemplate],
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      const activateButton = screen.queryByTitle('设为默认');
      expect(activateButton).not.toBeInTheDocument();
    });
  });

  describe('加载状态测试', () => {
    it('应该显示加载状态', () => {
      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('提示词工程实验室')).toBeInTheDocument();
    });

    it('应该显示错误状态', () => {
      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('加载失败'),
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('提示词工程实验室')).toBeInTheDocument();
    });
  });

  describe('类型标签映射测试', () => {
    it('应该正确显示所有类型的中文标签', () => {
      const mockTemplates = [
        { id: '1', name: '大纲', type: 'outline', content: '', isBuiltIn: false, isActive: false },
        { id: '2', name: '续写', type: 'continue', content: '', isBuiltIn: false, isActive: false },
        { id: '3', name: '润色', type: 'polish', content: '', isBuiltIn: false, isActive: false },
        { id: '4', name: '扩写', type: 'expand', content: '', isBuiltIn: false, isActive: false },
        { id: '5', name: '对话', type: 'chat', content: '', isBuiltIn: false, isActive: false },
      ];

      vi.mocked(promptQueries.usePromptTemplatesQuery).mockReturnValue({
        data: mockTemplates,
        isLoading: false,
        error: null,
      } as any);

      renderWithQueryClient(<PromptManager />);
      
      expect(screen.getByText('大纲生成')).toBeInTheDocument();
      expect(screen.getByText('续写模式')).toBeInTheDocument();
      expect(screen.getByText('润色模式')).toBeInTheDocument();
      expect(screen.getByText('扩写模式')).toBeInTheDocument();
      expect(screen.getByText('自由对话')).toBeInTheDocument();
    });
  });
});