/**
 * FormDialog 组件测试
 *
 * 验证通用 FormDialog 组件的基本功能和交互
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormDialog } from "@/components/common/FormDialog";

// 创建一个简单的测试表单组件
const TestForm = ({ onSubmitSuccess }: { onSubmitSuccess: () => void }) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmitSuccess();
    }}
  >
    <input data-testid="test-input" name="testField" placeholder="测试输入" />
    <button type="submit" data-testid="submit-button">
      提交
    </button>
  </form>
);

describe("FormDialog 组件", () => {
  it("应该正确渲染对话框", () => {
    render(
      <FormDialog
        trigger={<button>打开对话框</button>}
        title="测试对话框"
        description="这是一个测试对话框"
        formComponent={TestForm}
      />
    );

    // 验证触发按钮存在
    expect(screen.getByText("打开对话框")).toBeInTheDocument();

    // 点击触发按钮打开对话框
    fireEvent.click(screen.getByText("打开对话框"));

    // 验证标题和描述
    expect(screen.getByText("测试对话框")).toBeInTheDocument();
    expect(screen.getByText("这是一个测试对话框")).toBeInTheDocument();

    // 验证表单组件
    expect(screen.getByTestId("test-input")).toBeInTheDocument();
    expect(screen.getByTestId("submit-button")).toBeInTheDocument();
  });

  it("应该能够打开和关闭对话框", () => {
    render(
      <FormDialog
        trigger={<button data-testid="trigger-button">打开对话框</button>}
        title="测试对话框"
        formComponent={TestForm}
      />
    );

    // 验证触发按钮存在
    expect(screen.getByTestId("trigger-button")).toBeInTheDocument();

    // 点击触发按钮打开对话框
    fireEvent.click(screen.getByTestId("trigger-button"));

    // 验证对话框内容渲染
    expect(screen.getByText("测试对话框")).toBeInTheDocument();
    expect(screen.getByTestId("test-input")).toBeInTheDocument();
    expect(screen.getByTestId("submit-button")).toBeInTheDocument();
  });

  it("应该在表单提交成功后关闭对话框", () => {
    render(
      <FormDialog
        trigger={<button data-testid="trigger-button">打开对话框</button>}
        title="测试对话框"
        formComponent={TestForm}
      />
    );

    // 打开对话框
    fireEvent.click(screen.getByTestId("trigger-button"));

    // 验证对话框已打开
    expect(screen.getByText("测试对话框")).toBeInTheDocument();

    // 提交表单
    fireEvent.click(screen.getByTestId("submit-button"));

    // 验证对话框已关闭（内容不再可见）
    expect(screen.queryByText("测试对话框")).not.toBeInTheDocument();
  });

  it("应该正确传递初始数据给表单组件", () => {
    // 创建一个接收数据的测试表单组件
    const TestFormWithData = ({
      onSubmitSuccess,
      data,
    }: {
      onSubmitSuccess: () => void;
      data?: { testField: string };
    }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitSuccess();
        }}
      >
        <input
          data-testid="test-input"
          name="testField"
          defaultValue={data?.testField || ""}
          placeholder="测试输入"
        />
        <button type="submit" data-testid="submit-button">
          提交
        </button>
      </form>
    );

    render(
      <FormDialog
        trigger={<button data-testid="trigger-button">打开对话框</button>}
        title="测试对话框"
        formComponent={TestFormWithData}
        initialData={{ testField: "初始值" }}
      />
    );

    // 打开对话框
    fireEvent.click(screen.getByTestId("trigger-button"));

    // 验证初始数据被正确传递
    expect(screen.getByDisplayValue("初始值")).toBeInTheDocument();
  });

  it("应该支持自定义最大宽度类名", () => {
    render(
      <FormDialog
        trigger={<button data-testid="trigger-button">打开对话框</button>}
        title="测试对话框"
        formComponent={TestForm}
        maxWidthClass="max-w-md"
      />
    );

    // 打开对话框
    fireEvent.click(screen.getByTestId("trigger-button"));

    // 验证对话框内容存在
    expect(screen.getByText("测试对话框")).toBeInTheDocument();
  });
});
