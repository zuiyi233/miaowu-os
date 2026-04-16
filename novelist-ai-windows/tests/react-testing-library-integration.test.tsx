/**
 * React Testing Library 集成测试
 *
 * 验证 React Testing Library 是否正确集成到项目中
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("React Testing Library Integration Tests", () => {
  it("should render basic component", () => {
    render(<Button>Test Button</Button>);

    // 验证按钮文本存在
    expect(screen.getByText("Test Button")).toBeInTheDocument();
  });

  it("should query element attributes", () => {
    render(<Button variant="outline">Outline Button</Button>);

    // 验证按钮存在
    const button = screen.getByText("Outline Button");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
  });

  it("should handle user interactions", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Clickable Button</Button>);

    const button = screen.getByText("Clickable Button");
    button.click();

    // 验证点击事件被触发
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
