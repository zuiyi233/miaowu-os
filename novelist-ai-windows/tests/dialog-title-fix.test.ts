/**
 * DialogTitle 修复验证测试
 *
 * 测试目标：
 * 1. 验证 SettingsDialog 不再导入 DialogTitle 和 DialogDescription
 * 2. 验证 GlobalModalRenderer 始终渲染 DialogTitle
 * 3. 验证修复后的代码结构符合预期
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("DialogTitle 修复验证", () => {
  describe("SettingsDialog 组件", () => {
    it("应该不再导入 DialogTitle 和 DialogDescription", () => {
      const settingsDialogPath = path.join(__dirname, "../components/SettingsDialog.tsx");
      const settingsDialogContent = fs.readFileSync(settingsDialogPath, "utf-8");
      
      // 验证不再导入 DialogTitle 和 DialogDescription
      expect(settingsDialogContent).not.toContain('import { DialogTitle, DialogDescription } from "./ui/dialog"');
      
      // 验证使用普通 HTML 标签
      expect(settingsDialogContent).toContain('<h2 className="text-2xl font-semibold">');
      expect(settingsDialogContent).toContain('<p className="text-muted-foreground mt-1">');
      
      // 验证不再使用 DialogTitle 和 DialogDescription 组件
      expect(settingsDialogContent).not.toContain('<DialogTitle');
      expect(settingsDialogContent).not.toContain('<DialogDescription');
    });
  });

  describe("GlobalModalRenderer 组件", () => {
    it("应该始终渲染 DialogTitle", () => {
      const globalModalRendererPath = path.join(__dirname, "../components/common/GlobalModalRenderer.tsx");
      const globalModalRendererContent = fs.readFileSync(globalModalRendererPath, "utf-8");
      
      // 验证始终渲染 DialogHeader 和 DialogTitle
      expect(globalModalRendererContent).toContain("<DialogHeader>");
      expect(globalModalRendererContent).toContain("<DialogTitle");
      
      // 验证提供后备标题
      expect(globalModalRendererContent).toContain('{title || "对话框"}');
      
      // 验证在没有 title 时使用 sr-only 类
      expect(globalModalRendererContent).toContain('className={!title ? "sr-only" : ""}');
    });
  });

  describe("Sidebar 组件", () => {
    it("应该正确传递 title 和 description", () => {
      const sidebarPath = path.join(__dirname, "../components/Sidebar.tsx");
      const sidebarContent = fs.readFileSync(sidebarPath, "utf-8");
      
      // 验证 Sidebar 正确传递 title 和 description
      expect(sidebarContent).toContain('title: "应用设置"');
      expect(sidebarContent).toContain('description: "在这里管理编辑器、AI 和数据相关的应用配置。"');
    });
  });
});