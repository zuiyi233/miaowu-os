/**
 * 基础集成测试
 *
 * 验证 React Testing Library 基本功能是否正常工作
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// 创建一个简单的 React 组件用于测试
const TestComponent = () => React.createElement("div", null, "Hello World");

describe("基础集成测试", () => {
  it("应该能够渲染基本组件", () => {
    render(React.createElement(TestComponent));

    // 验证文本存在
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("应该能够验证元素存在", () => {
    render(
      React.createElement(
        "button",
        { "data-testid": "test-button" },
        "Click me"
      )
    );

    // 验证按钮存在
    const button = screen.getByTestId("test-button");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
  });

  it("应该能够模拟用户交互", () => {
    const handleClick = vi.fn();
    render(
      React.createElement(
        "button",
        {
          onClick: handleClick,
          "data-testid": "clickable-button",
        },
        "Click me"
      )
    );

    const button = screen.getByTestId("clickable-button");
    button.click();

    // 验证点击事件被触发
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
