import React from "react";
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";
import { ThemeToggle } from "./ThemeToggle";
import {
  Menu,
  Sparkles,
  PenTool,
  Network,
  Clock,
  Home,
  BookOpen,
  MessageSquare,
  ListTree,
} from "lucide-react"; // 引入 BookOpen
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import type { Theme } from "../types";

interface AppHeaderProps {
  theme: Theme;
  onThemeToggle: () => void;
  onToggleSidebar: () => void;
  onToggleAiPanel: () => void;
  isMobile?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  theme,
  onThemeToggle,
  onToggleSidebar,
  onToggleAiPanel,
}) => {
  const { data: novelTitle, isLoading } = useNovelDataSelector(
    (novel) => novel?.title
  );

  const { viewMode, setViewMode } = useUiStore();

  // ✅ 逻辑修正：根据视图模式决定标题显示
  const displayTitle =
    viewMode === "home"
      ? "Mì Jìng · 秘境"
      : isLoading
      ? "加载中..."
      : novelTitle || "未命名作品";

  // ✅ 逻辑修正：Icon 也随之变化
  const TitleIcon = viewMode === "home" ? BookOpen : PenTool;

  return (
    <header className="flex items-center justify-between px-4 h-14 border-b bg-background/80 backdrop-blur-md z-50 sticky top-0 transition-all duration-300">
      <div className="flex items-center gap-3">
        {/* Home 模式下隐藏侧边栏开关，因为它没有意义 */}
        {viewMode !== "home" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            aria-label="Toggle Sidebar"
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-5 h-5" />
          </Button>
        )}

        {/* Home 按钮：只在非 Home 模式显示，或者一直显示作为 Logo 点击 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setViewMode("home")}
          className={
            viewMode === "home"
              ? "bg-accent/50 text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }
          title="回到首页"
        >
          <Home className="w-5 h-5" />
        </Button>

        {/* 分隔线 */}
        <div className="h-4 w-[1px] bg-border/60 mx-1" />

        {/* 标题区域 */}
        <div
          className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300"
          key={viewMode}
        >
          <TitleIcon className="w-4 h-4 text-primary/70" />
          <h1
            className={`text-sm md:text-base font-semibold font-['Plus_Jakarta_Sans'] tracking-tight ${
              viewMode === "home" ? "text-primary" : "text-foreground"
            }`}
          >
            {displayTitle}
          </h1>
        </div>
      </div>

      {/* 中间 Tab 切换器：仅在进入具体小说后显示 */}
      {viewMode !== "home" && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block">
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as any)}
            className="h-8"
          >
            <TabsList className="h-8 bg-muted/50 p-0.5 border border-border/40">
              <TabsTrigger
                value="editor"
                className="text-xs px-3 h-7 data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <PenTool className="w-3 h-3 mr-1.5 opacity-70" /> 写作
              </TabsTrigger>
              <TabsTrigger
                value="graph"
                className="text-xs px-3 h-7 data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <Network className="w-3 h-3 mr-1.5 opacity-70" /> 关系网
              </TabsTrigger>
              <TabsTrigger
                value="timeline"
                className="text-xs px-3 h-7 data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <Clock className="w-3 h-3 mr-1.5 opacity-70" /> 时间线
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                className="text-xs px-3 h-7 data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <MessageSquare className="w-3 h-3 mr-1.5 opacity-70" /> 对话
              </TabsTrigger>
              <TabsTrigger
                value="outline"
                className="text-xs px-3 h-7 data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <ListTree className="w-3 h-3 mr-1.5 opacity-70" /> 大纲规划中心
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="flex items-center gap-2">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />

        {/* ✅ 修复：移除 viewMode !== 'home' 的判断，让按钮常驻 */}
        <Button
          variant={viewMode === "home" ? "outline" : "ghost"}
          size={viewMode === "home" ? "sm" : "icon"}
          onClick={onToggleAiPanel}
          aria-label="Toggle AI Panel"
          className={
            viewMode === "home"
              ? "gap-2 text-primary border-primary/20 bg-primary/5 hover:bg-primary/10"
              : "text-primary hover:bg-primary/10 hover:text-primary transition-colors"
          }
        >
          <Sparkles className="w-5 h-5" />
          {/* 在首页显示文字，更显眼 */}
          {viewMode === "home" && (
            <span className="hidden sm:inline">AI 助手</span>
          )}
        </Button>
      </div>
    </header>
  );
};
