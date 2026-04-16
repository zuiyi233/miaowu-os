import React, { useState } from "react";
import { ChatSidebar } from "./ChatSidebar";
import { ChatInterface } from "./ChatInterface";
import { useChatSessionQuery } from "@/lib/react-query/chat.queries";
import { MessageSquareDashed, Menu } from "lucide-react"; // 引入 Menu 图标
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet"; // 引入 Sheet 用于移动端
import { useMediaQuery } from "@/hooks/useMediaQuery";

export const ChatPage: React.FC = () => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { data: activeSession } = useChatSessionQuery(activeSessionId);

  // 响应式处理
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    if (!isDesktop) setIsMobileSidebarOpen(false); // 移动端选择后关闭侧边栏
  };

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* 桌面端侧边栏 */}
      {isDesktop && (
        <ChatSidebar
          currentSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
        />
      )}

      {/* 移动端侧边栏 (抽屉) */}
      {!isDesktop && (
        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[80%]">
            <ChatSidebar
              currentSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* 主区域 */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative">
        {/* 移动端 Header */}
        {!isDesktop && (
          <div className="h-12 border-b flex items-center px-4 bg-background/95 backdrop-blur z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <span className="ml-2 font-semibold text-sm">
              {activeSession ? activeSession.title : "Mì Jìng AI"}
            </span>
          </div>
        )}

        {activeSession ? (
          <ChatInterface key={activeSession.id} session={activeSession} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mb-6 ring-1 ring-primary/20">
              <MessageSquareDashed className="w-10 h-10 text-primary/60" />
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-3 font-['Lora']">
              开始新的对话
            </h3>
            <p className="max-w-md text-muted-foreground mb-8 leading-relaxed">
              这里是你的灵感空间。选择左侧的历史记录，或者创建一个新对话，与 AI
              一起探讨剧情、设定世界观，或者仅仅是聊聊想法。
            </p>

            {/* 快捷操作卡片 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
              <button className="p-4 border rounded-xl hover:bg-accent/50 hover:border-primary/30 transition-all text-left group">
                <div className="font-medium text-foreground group-hover:text-primary mb-1">
                  剧情头脑风暴
                </div>
                <div className="text-xs">"帮我构思一个反转结局..."</div>
              </button>
              <button className="p-4 border rounded-xl hover:bg-accent/50 hover:border-primary/30 transition-all text-left group">
                <div className="font-medium text-foreground group-hover:text-primary mb-1">
                  角色设定深化
                </div>
                <div className="text-xs">"如何让主角的动机更合理？"</div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
