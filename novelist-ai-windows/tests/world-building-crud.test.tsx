/**
 * 世界观构建 CRUD 功能测试
 * 验证 Faction 和 Setting 的增删改查功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FactionEditForm } from '../components/FactionEditForm';
import { SettingEditForm } from '../components/SettingEditForm';
import { FactionDetail } from '../components/FactionDetail';
import { SettingDetail } from '../components/SettingDetail';
import type { Faction, Setting } from '../types';

// 模拟数据库服务
vi.mock('../lib/storage/db', () => ({
  databaseService: {
    updateFaction: vi.fn().mockResolvedValue(undefined),
    deleteFaction: vi.fn().mockResolvedValue(undefined),
    updateSetting: vi.fn().mockResolvedValue(undefined),
    deleteSetting: vi.fn().mockResolvedValue(undefined),
  },
}));

// 模拟 useUiStore
vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({
    currentNovelTitle: 'Test Novel',
  }),
}));

// 模拟 useModalStore
vi.mock('../stores/useModalStore', () => ({
  useModalStore: () => ({
    open: vi.fn(),
  }),
}));

// 创建测试用的 QueryClient
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
});

// 测试包装器组件
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('世界观构建 CRUD 功能测试', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  describe('Faction CRUD 功能', () => {
    const mockFaction: Faction = {
      id: 'test-faction-1',
      name: '测试势力',
      description: '这是一个测试势力',
      ideology: '测试理念',
      leaderId: 'test-character-1',
    };

    it('FactionEditForm 应该正确渲染和提交', async () => {
      const mockOnSubmitSuccess = vi.fn();
      const mockOnClose = vi.fn();

      render(
        <TestWrapper>
          <FactionEditForm
            faction={mockFaction}
            onSubmitSuccess={mockOnSubmitSuccess}
            onClose={mockOnClose}
          />
        </TestWrapper>
      );

      // 验证表单字段是否正确预填
      expect(screen.getByDisplayValue('测试势力')).toBeInTheDocument();
      expect(screen.getByDisplayValue('这是一个测试势力')).toBeInTheDocument();
      expect(screen.getByDisplayValue('测试理念')).toBeInTheDocument();

      // 修改表单数据
      const nameInput = screen.getByLabelText('势力名称');
      await user.clear(nameInput);
      await user.type(nameInput, '更新后的势力名称');

      // 提交表单
      const submitButton = screen.getByRole('button', { name: '保存更改' });
      await user.click(submitButton);

      // 验证提交成功回调被调用
      await waitFor(() => {
        expect(mockOnSubmitSuccess).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('FactionDetail 应该正确显示编辑和删除按钮', () => {
      const mockOnClose = vi.fn();

      render(
        <TestWrapper>
          <FactionDetail
            faction={mockFaction}
            onClose={mockOnClose}
          />
        </TestWrapper>
      );

      // 验证基本信息显示
      expect(screen.getByText('测试势力')).toBeInTheDocument();
      expect(screen.getByText('这是一个测试势力')).toBeInTheDocument();
      expect(screen.getByText('测试理念')).toBeInTheDocument();

      // 验证操作按钮存在
      expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
    });
  });

  describe('Setting CRUD 功能', () => {
    const mockSetting: Setting = {
      id: 'test-setting-1',
      name: '测试场景',
      description: '这是一个测试场景',
    };

    it('SettingEditForm 应该正确渲染和提交', async () => {
      const mockOnSubmitSuccess = vi.fn();
      const mockOnClose = vi.fn();

      render(
        <TestWrapper>
          <SettingEditForm
            setting={mockSetting}
            onSubmitSuccess={mockOnSubmitSuccess}
            onClose={mockOnClose}
          />
        </TestWrapper>
      );

      // 验证表单字段是否正确预填
      expect(screen.getByDisplayValue('测试场景')).toBeInTheDocument();
      expect(screen.getByDisplayValue('这是一个测试场景')).toBeInTheDocument();

      // 修改表单数据
      const nameInput = screen.getByLabelText('场景名');
      await user.clear(nameInput);
      await user.type(nameInput, '更新后的场景名称');

      // 提交表单
      const submitButton = screen.getByRole('button', { name: '保存更改' });
      await user.click(submitButton);

      // 验证提交成功回调被调用
      await waitFor(() => {
        expect(mockOnSubmitSuccess).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('SettingDetail 应该正确显示编辑和删除按钮', () => {
      const mockOnClose = vi.fn();

      render(
        <TestWrapper>
          <SettingDetail
            setting={mockSetting}
            onClose={mockOnClose}
          />
        </TestWrapper>
      );

      // 验证基本信息显示
      expect(screen.getByText('测试场景')).toBeInTheDocument();
      expect(screen.getByText('这是一个测试场景')).toBeInTheDocument();

      // 验证操作按钮存在
      expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
    });
  });
});