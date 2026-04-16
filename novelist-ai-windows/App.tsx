import React, { useRef, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { AiPanel } from "./components/AiPanel";
import { AppHeader } from "./components/AppHeader";
import { CommandPalette } from "./components/CommandPalette";
import { GlobalModalRenderer } from "./components/common/GlobalModalRenderer";
import { TimelineView } from "./components/timeline/TimelineView";
import { RelationshipGraph } from "./components/visualization/RelationshipGraph";
import { Dashboard } from "./components/Dashboard"; // ✅ 导入 Dashboard 组件
import { ChatPage } from "./components/chat/ChatPage"; // ✅ 导入 ChatPage 组件
import { OutlineView } from "./components/outline/OutlineView"; // ✅ 导入 OutlineView 组件
import { BackgroundEmbedder } from "./components/common/BackgroundEmbedder"; // ✅ 新增：后台向量化处理器
import { useBrowserNavigation } from "./hooks/useBrowserNavigation";
import { useUnsavedChangesWarning } from "./hooks/useUnsavedChangesWarning";
import { useMediaQuery } from "./hooks/useMediaQuery";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { Sheet, SheetContent } from "./components/ui/sheet";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { Toaster } from "./components/ui/sonner";
import { useTheme } from "./hooks/useTheme";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { databaseService } from "./lib/storage/db";
import { useUiStore } from "./stores/useUiStore";

function App() {
  const { theme, cycleTheme } = useTheme();
  const { viewMode, setViewMode } = useUiStore(); // ✅ 新增：获取 setViewMode
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // ✅ 2. 新增移动端 AI 面板状态
  const [isMobileAiPanelOpen, setIsMobileAiPanelOpen] = useState(false);

  // 🎯 全局快捷键系统 - 提升用户操作效率
  useGlobalShortcuts();

  // ✅ 启用导航保护
  useBrowserNavigation();

  // ✅ 启用防误关保护
  useUnsavedChangesWarning();

  // ✅ 移动端适配
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // ✅ 添加应用初始化逻辑
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // 检查默认小说是否存在，如果不存在则创建
        const defaultNovelExists = await databaseService.loadNovel(
          "The Crimson Cipher"
        );
        if (!defaultNovelExists) {
          await databaseService.initializeDefaultNovel();
          // 可以选择性地更新 UI Store，确保它知道默认小说已准备就绪
          useUiStore.getState().setCurrentNovelTitle("The Crimson Cipher");
        }

        // 检查基本提示词模板是否存在（只检查基础模板）
        const existingTemplates = await databaseService.getAllPromptTemplates();
        if (existingTemplates.length === 0) {
          console.log("未找到提示词模板，触发数据库升级");
          // 重新打开数据库以触发升级逻辑
          await databaseService.loadNovel("The Crimson Cipher");
        }
      } catch (error) {
        console.error("应用初始化失败:", error);
      }
    };

    initializeApp();
  }, []); // 空依赖数组，确保只在应用启动时运行一次

  const toggleSidebar = () => {
    if (isDesktop) {
      const panel = sidebarPanelRef.current;
      if (panel) {
        if (panel.isCollapsed()) {
          panel.expand();
        } else {
          panel.collapse();
        }
      }
    } else {
      setIsMobileSidebarOpen(true);
    }
  };

  // ✅ 修改：统一的 AI 面板切换逻辑
  const toggleAiPanel = () => {
    if (viewMode === "home") {
      // 1. 在首页：直接跳转到独立聊天页面
      setViewMode("chat");
    } else if (viewMode === "chat") {
      // 2. 在聊天页：返回首页（或者返回上一个视图，这里简单处理回首页）
      setViewMode("home");
    } else {
      if (isDesktop) {
        // Desktop 逻辑保持不变
        const panel = aiPanelRef.current;
        if (panel) {
          if (panel.isCollapsed()) panel.expand();
          else panel.collapse();
        }
      } else {
        // ✅ 3. Mobile 逻辑：切换 Sheet 状态
        setIsMobileAiPanelOpen(!isMobileAiPanelOpen);
      }
    }
  };

  // ✅ 修改：专门处理 Dashboard 的 AI 入口
  const handleDashboardAiClick = () => {
    setViewMode("chat");
  };

  return (
    <>
      {/* ✅ 高效修复：为全局模态框创建一个拥有最高 z-index 的堆叠上下文 */}
      <div className="relative z-[100]">
        <GlobalModalRenderer />
      </div>

      {/* ✅ 新增：后台向量化处理器 - 无UI组件，在应用顶层运行 */}
      <BackgroundEmbedder />

      <CommandPalette />
      <div className="h-screen w-full flex flex-col overflow-hidden">
        <AppHeader
          theme={theme}
          onThemeToggle={cycleTheme}
          onToggleSidebar={toggleSidebar}
          onToggleAiPanel={toggleAiPanel}
          isMobile={!isDesktop}
        />
        <main className="flex-1 relative overflow-hidden flex flex-col">
          {/* Dashboard View */}
          {viewMode === "home" && (
            <>
              {/* ✅ 传入新的点击处理函数 */}
              <Dashboard onOpenAiChat={handleDashboardAiClick} />

              {/* ❌ 删除：首页不再需要 Sheet 形式的 AI 面板 */}
            </>
          )}

          {/* ✅ 使用 display: none 而不是条件渲染，以保持编辑器状态（不重置滚动条和撤销栈） */}
          <div className={viewMode === "editor" ? "h-full w-full" : "hidden"}>
            {isDesktop ? (
              // 🖥️ 桌面端：保持原有的 ResizablePanelGroup
              <ResizablePanelGroup
                direction="horizontal"
                className="h-full w-full"
              >
                <ResizablePanel
                  ref={sidebarPanelRef}
                  defaultSize={20}
                  minSize={15}
                  maxSize={30}
                  collapsible
                  collapsedSize={0}
                >
                  <Sidebar />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={55} minSize={30}>
                  <Editor />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  ref={aiPanelRef}
                  defaultSize={25}
                  minSize={20}
                  maxSize={40}
                  collapsible
                  collapsedSize={0}
                >
                  <AiPanel />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              // 📱 移动端：简单的 Flex 布局 + Sheet 侧边栏
              <div className="h-full w-full relative">
                <Editor /> {/* 编辑器全屏 */}
                {/* 左侧 Sidebar Sheet */}
                <Sheet
                  open={isMobileSidebarOpen}
                  onOpenChange={setIsMobileSidebarOpen}
                >
                  <SheetContent side="left" className="p-0 w-[85%]">
                    <Sidebar />
                  </SheetContent>
                </Sheet>
                {/* ✅ 4. 新增：右侧 AI Panel Sheet */}
                <Sheet
                  open={isMobileAiPanelOpen}
                  onOpenChange={setIsMobileAiPanelOpen}
                >
                  {/* 注意：AiPanel 内部有 Tabs，宽度需要足够 */}
                  <SheetContent
                    side="right"
                    className="p-0 w-[90%] sm:w-[400px]"
                  >
                    <AiPanel />
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </div>

          {/* ✅ 全屏视图模式 */}
          {viewMode === "graph" && (
            <div className="h-full w-full animate-in fade-in duration-300">
              <RelationshipGraph />
            </div>
          )}

          {viewMode === "timeline" && (
            <div className="h-full w-full animate-in fade-in duration-300 bg-background">
              <TimelineView />
            </div>
          )}

          {viewMode === "chat" && (
            <div className="h-full w-full animate-in fade-in duration-300">
              <ChatPage />
            </div>
          )}

          {viewMode === "outline" && (
            <div className="h-full w-full animate-in fade-in duration-300">
              <OutlineView />
            </div>
          )}
        </main>
      </div>
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  );
}

export default App;
