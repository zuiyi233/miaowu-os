import React from "react";
import {
  useChatSessionsQuery,
  useDeleteChatSessionMutation,
  useCreateChatSessionMutation,
} from "@/lib/react-query/chat.queries";
import { useUiStore } from "@/stores/useUiStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Trash2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

interface ChatSidebarProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  currentSessionId,
  onSelectSession,
}) => {
  const currentNovelTitle = useUiStore((s) => s.currentNovelTitle);
  // 如果在首页，novelId 为空；如果在小说内，则筛选该小说的对话
  const novelId =
    useUiStore((s) => s.viewMode) === "home" ? undefined : currentNovelTitle;

  const { data: sessions = [], isLoading } = useChatSessionsQuery(novelId);
  const createMutation = useCreateChatSessionMutation();
  const deleteMutation = useDeleteChatSessionMutation();

  const handleCreateNew = async () => {
    const newSession = await createMutation.mutateAsync({
      title: "新对话",
      novelId: novelId || undefined,
      initialMessage:
        "你好！我是你的 AI 写作助手。我们可以聊聊大纲、设定，或者对剧情进行头脑风暴。",
    });
    onSelectSession(newSession.id);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("确定要删除这个对话吗？")) {
      deleteMutation.mutate(id);
      if (currentSessionId === id) {
        onSelectSession("");
      }
    }
  };

  return (
    <div className="w-64 border-r h-full flex flex-col bg-muted/10">
      <div className="p-4 border-b">
        <Button
          onClick={handleCreateNew}
          className="w-full justify-start gap-2"
          variant="default"
        >
          <Plus className="w-4 h-4" /> 新建对话
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && (
            <div className="text-xs text-center py-4 text-muted-foreground">
              加载中...
            </div>
          )}

          {!isLoading && sessions.length === 0 && (
            <div className="text-xs text-center py-8 text-muted-foreground">
              暂无历史记录
            </div>
          )}

          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "group flex items-center justify-between px-3 py-2.5 text-sm rounded-md cursor-pointer transition-colors",
                currentSessionId === session.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MessageSquare className="w-4 h-4 shrink-0" />
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate">{session.title}</span>
                  <span className="text-[10px] opacity-60 font-normal">
                    {formatDistanceToNow(session.updatedAt, {
                      locale: zhCN,
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => handleDelete(e, session.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
