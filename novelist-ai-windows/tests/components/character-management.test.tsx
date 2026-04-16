/**
 * 角色管理组件交互测试
 *
 * 测试角色创建的完整用户流程，包括：
 * 1. 打开角色创建对话框
 * 2. 填写表单
 * 3. 提交表单
 * 4. 验证角色出现在侧边栏中
 *
 * 遵循测试最佳实践：
 * - 面向用户行为而非实现细节
 * - 使用有意义的测试描述
 * - 模拟真实的用户交互
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../../App";

// 模拟数据库服务
vi.mock("../../lib/storage/db", () => ({
  databaseService: {
    loadNovel: vi.fn().mockResolvedValue({
      title: "Test Novel",
      outline: "Test outline",
      volumes: [],
      chapters: [],
      characters: [],
      settings: [],
    }),
    saveNovel: vi.fn().mockResolvedValue(undefined),
  },
}));

// 模拟角色创建 Action
vi.mock("../../actions/characterActions", () => ({
  addCharacterAction: vi.fn().mockImplementation(async (formData: FormData) => {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;

    if (!name || name.trim().length === 0) {
      return {
        errors: { name: ["角色名称不能为空"] },
        message: "",
      };
    }

    return {
      success: true,
      message: "角色创建成功",
      data: {
        id: "char1",
        name: name.trim(),
        description: description?.trim() || "",
      },
    };
  }),
}));

// 创建测试用的 QueryClient
const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
};

// 测试包装器组件
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("角色管理流程", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  it("应该允许用户创建新角色", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 找到并点击"添加角色"按钮
    const addCharacterButton = await screen.findByRole("button", {
      name: /添加角色/i,
    });
    expect(addCharacterButton).toBeInTheDocument();

    await user.click(addCharacterButton);

    // 2. 验证对话框打开
    const dialogTitle = await screen.findByRole("heading", {
      name: /创建新角色/i,
    });
    expect(dialogTitle).toBeInTheDocument();

    // 3. 填写角色表单
    const nameInput = screen.getByPlaceholderText(/例如：艾拉/i);
    const descriptionInput =
      screen.getByPlaceholderText(/外貌、性格、背景故事/i);
    const submitButton = screen.getByRole("button", { name: /保存角色/i });

    await user.type(nameInput, "测试角色-阿拉贡");
    await user.type(descriptionInput, "一个勇敢的游侠");

    // 4. 提交表单
    await user.click(submitButton);

    // 5. 验证表单提交成功（对话框关闭）
    await waitFor(() => {
      expect(dialogTitle).not.toBeInTheDocument();
    });

    // 6. 验证新角色出现在侧边栏中
    await waitFor(() => {
      const characterCard = screen.getByText("测试角色-阿拉贡");
      expect(characterCard).toBeInTheDocument();
    });

    // 7. 验证角色描述也显示正确
    const characterDescription = screen.getByText("一个勇敢的游侠");
    expect(characterDescription).toBeInTheDocument();
  });

  it("应该在表单验证失败时显示错误信息", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 打开角色创建对话框
    const addCharacterButton = await screen.findByRole("button", {
      name: /添加角色/i,
    });
    await user.click(addCharacterButton);

    // 2. 尝试提交空表单
    const submitButton = screen.getByRole("button", { name: /保存角色/i });
    await user.click(submitButton);

    // 3. 验证错误信息显示
    await waitFor(() => {
      const errorMessage = screen.getByText("角色名称不能为空");
      expect(errorMessage).toBeInTheDocument();
    });

    // 4. 验证对话框仍然打开（提交失败）
    const dialogTitle = screen.getByRole("heading", { name: /创建新角色/i });
    expect(dialogTitle).toBeInTheDocument();
  });

  it("应该在用户取消时关闭对话框而不创建角色", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 打开角色创建对话框
    const addCharacterButton = await screen.findByRole("button", {
      name: /添加角色/i,
    });
    await user.click(addCharacterButton);

    // 2. 填写部分表单
    const nameInput = screen.getByPlaceholderText(/例如：艾拉/i);
    await user.type(nameInput, "未完成的角色");

    // 3. 按 ESC 键关闭对话框
    await user.keyboard("{Escape}");

    // 4. 验证对话框关闭
    await waitFor(() => {
      const dialogTitle = screen.queryByRole("heading", {
        name: /创建新角色/i,
      });
      expect(dialogTitle).not.toBeInTheDocument();
    });

    // 5. 验证角色没有被创建
    const characterCard = screen.queryByText("未完成的角色");
    expect(characterCard).not.toBeInTheDocument();
  });

  it("应该在表单提交过程中显示加载状态", async () => {
    // 模拟慢速的表单提交
    vi.mock("../../actions/characterActions", () => ({
      addCharacterAction: vi
        .fn()
        .mockImplementation(async (formData: FormData) => {
          // 模拟网络延迟
          await new Promise((resolve) => setTimeout(resolve, 100));

          const name = formData.get("name") as string;
          return {
            success: true,
            message: "角色创建成功",
            data: {
              id: "char1",
              name: name.trim(),
              description: "",
            },
          };
        }),
    }));

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 打开角色创建对话框
    const addCharacterButton = await screen.findByRole("button", {
      name: /添加角色/i,
    });
    await user.click(addCharacterButton);

    // 2. 填写表单
    const nameInput = screen.getByPlaceholderText(/例如：艾拉/i);
    const submitButton = screen.getByRole("button", { name: /保存角色/i });

    await user.type(nameInput, "测试角色");

    // 3. 提交表单
    await user.click(submitButton);

    // 4. 验证加载状态
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent("创建中...");

    // 5. 等待提交完成
    await waitFor(() => {
      expect(submitButton).not.toBeInTheDocument();
    });
  });
});

describe("角色管理可访问性", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  it("应该支持键盘导航", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 使用 Tab 键导航到添加角色按钮
    await user.tab();
    await user.tab();
    await user.tab(); // 根据实际布局调整 tab 次数

    const addCharacterButton = screen.getByRole("button", {
      name: /添加角色/i,
    });
    expect(addCharacterButton).toHaveFocus();

    // 2. 按 Enter 键打开对话框
    await user.keyboard("{Enter}");

    // 3. 验证对话框打开并聚焦到第一个输入框
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/例如：艾拉/i);
      expect(nameInput).toHaveFocus();
    });
  });

  it("应该有适当的 ARIA 标签", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // 1. 打开角色创建对话框
    const addCharacterButton = await screen.findByRole("button", {
      name: /添加角色/i,
    });
    await user.click(addCharacterButton);

    // 2. 验证对话框的 ARIA 属性
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // 3. 验证表单字段的标签
    const nameInput = screen.getByPlaceholderText(/例如：艾拉/i);
    expect(nameInput).toHaveAttribute("aria-describedby");

    // 4. 验证按钮的可访问性名称
    const submitButton = screen.getByRole("button", { name: /保存角色/i });
    expect(submitButton).toHaveAccessibleName("保存角色");
  });
});
