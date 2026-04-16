import React, { useState, useRef, useEffect } from "react";
import { ChatMessage, ChatSession } from "@/types";
import { useUpdateChatSessionMutation } from "@/lib/react-query/chat.queries";
import { advancedStreamChat } from "@/services/llmService";
import { contextEngineService } from "@/services/contextEngineService";
import type { ContextAnalysisOptions } from "@/services/contextEngineService";
import { generateUniqueId } from "@/lib/utils/id";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Loader2,
  Send,
  Bot,
  User,
  Sparkles,
  Eraser,
  MapPin,
  Shield,
  Gem,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatHeader, ContextOptions } from "./ChatHeader"; // ✅ 引入 Header 和类型

// 实体图标组件
const EntityIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "character":
      return <User className="w-3 h-3" />;
    case "setting":
      return <MapPin className="w-3 h-3" />;
    case "faction":
      return <Shield className="w-3 h-3" />;
    case "item":
      return <Gem className="w-3 h-3" />;
    default:
      return <BookOpen className="w-3 h-3" />;
  }
};

// 上下文引用指示器组件
const ContextIndicator: React.FC<{
  entities?: ChatMessage["contextEntities"];
}> = ({ entities }) => {
  if (!entities || entities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 mt-1 justify-end">
      <span className="text-[10px] text-muted-foreground flex items-center mr-1">
        <Sparkles className="w-3 h-3 mr-1" /> 已引用:
      </span>
      {entities.map((e, i) => (
        <div
          key={`${e.id}-${i}`}
          className="text-[10px] h-5 px-1.5 bg-background/50 gap-1 font-normal text-muted-foreground border-border/60 border rounded-md flex items-center"
        >
          <EntityIcon type={e.type} />
          {e.name}
        </div>
      ))}
    </div>
  );
};

// 思考过程展示组件
const ThinkingProcess: React.FC<{ content: string; isThinking?: boolean }> = ({
  content,
  isThinking,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  // 如果没有思考内容且不在思考中，不渲染
  if (!content && !isThinking) return null;

  return (
    <div className="w-full mb-3 border rounded-md bg-muted/30 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <Button
        variant="ghost"
        size="sm"
        className="w-full flex items-center justify-between px-3 py-2 h-8 text-xs text-muted-foreground hover:bg-muted/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3 h-3" />
          <span>{isThinking ? "深度思考中..." : "思考过程"}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </Button>
      {isOpen && (
        <div className="px-3 py-2 text-xs text-muted-foreground/80 leading-relaxed border-t border-border/50 bg-muted/20 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
          {content}
          {isThinking && (
            <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-primary/50 animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
};

// 格式化消息组件
const FormattedMessage: React.FC<{
  message: ChatMessage;
  isStreaming?: boolean;
}> = ({ message, isStreaming = false }) => {
  const { content, role, reasoning } = message;

  return (
    <div className="w-full min-w-0">
      {role === "user" && (
        <ContextIndicator entities={message.contextEntities} />
      )}

      {/* 助手消息：显示思考过程 */}
      {role === "assistant" && reasoning && (
        <ThinkingProcess content={reasoning} isThinking={false} />
      )}

      {/* 助手消息：显示正文 */}
      <div className="text-sm leading-relaxed break-words">
        {role === "user" ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div className="prose dark:prose-invert max-w-none prose-sm prose-p:my-1 prose-ul:my-1 prose-li:my-0 [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node, ...props }) => (
                  <span
                    className="text-primary underline underline-offset-2"
                    {...props}
                  />
                ),
                code: ({ node, className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || "");
                  return match ? (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  ) : (
                    <code
                      className="bg-muted px-1 py-0.5 rounded font-mono text-xs"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}

        {/* 光标闪烁效果：仅在流式传输且内容尚未完全显示时显示 */}
        {role === "assistant" && isStreaming && (
          <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse align-middle ml-1" />
        )}
      </div>
    </div>
  );
};

interface ChatInterfaceProps {
  session: ChatSession;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ session }) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // ✅ 修改：使用对象管理上下文选项，默认开启世界观
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    enabled: true,
    includeWorld: true,
    includeChapter: true, // 默认开启章节上下文，这很常用
    includeOutline: false,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // ✅ Token 统计状态 - 使用 session.id 作为 key 来重置状态
  const [tokenStats, setTokenStats] = useState({
    prompt: 0,
    completion: 0,
    total: 0,
  });

  const updateSessionMutation = useUpdateChatSessionMutation();

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [session.messages.length, isLoading]);

  // 估算输入 Token (简单估算: 1 中文 = 1 token, 4 英文 = 1 token)
  const estimateInputTokens = (text: string) => {
    const len = text.length;
    // 这是一个非常粗略的估算，仅用于 UI 展示
    return Math.ceil(len * 0.7);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userContent = input.trim();
    setInput("");
    setIsLoading(true);

    // 1. 构建用户消息
    const userMsg: ChatMessage = {
      id: generateUniqueId("msg"),
      role: "user",
      content: userContent,
      timestamp: Date.now(),
    };

    // 2. 乐观更新 UI
    const newMessages = [...session.messages, userMsg];

    // 3. 智能生成标题 (如果是第一条用户消息)
    let newTitle = session.title;
    if (session.messages.length <= 1) {
      newTitle =
        userContent.slice(0, 20) + (userContent.length > 20 ? "..." : "");
    }

    // 4. 保存用户消息到 DB
    await updateSessionMutation.mutateAsync({
      ...session,
      title: newTitle,
      messages: newMessages,
    });

    try {
      // 5. 上下文增强
      let finalPrompt = userContent;
      let usedEntities: any[] = [];

      if (contextOptions.enabled) {
        try {
          // ✅ 传递细粒度的选项
          const options: ContextAnalysisOptions = {
            includeWorld: contextOptions.includeWorld,
            includeChapter: contextOptions.includeChapter,
            includeOutline: contextOptions.includeOutline,
          };

          const result = await contextEngineService.analyzeContextWithOptions(
            userContent,
            options
          );

          if (result.prompt !== userContent) {
            finalPrompt = result.prompt;
            usedEntities = result.usedEntities;
            userMsg.contextEntities = usedEntities;
          }
        } catch (e) {
          console.warn("Context injection failed", e);
        }
      }

      // 6. 准备历史记录 (用于 API)
      const apiHistory = newMessages
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      // 替换最后一条为增强后的 prompt
      apiHistory[apiHistory.length - 1].content = finalPrompt;

      // 7. 准备助手消息占位符
      let assistantContent = "";
      let assistantReasoning = "";
      const assistantMsgId = generateUniqueId("msg");

      // 8. 流式请求
      await advancedStreamChat(apiHistory, {
        onMessage: (chunk) => {
          assistantContent += chunk;
        },
        onReasoning: (chunk) => {
          assistantReasoning += chunk;
        },
        // ✅ 处理 Usage 回调
        onUsage: (usage) => {
          setTokenStats((prev) => ({
            prompt: prev.prompt + usage.prompt_tokens,
            completion: prev.completion + usage.completion_tokens,
            total: prev.total + usage.total_tokens,
          }));
        },
        onFinish: async () => {
          // 9. 保存助手消息
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: "assistant",
            content: assistantContent,
            reasoning: assistantReasoning,
            timestamp: Date.now(),
          };

          await updateSessionMutation.mutateAsync({
            ...session,
            title: newTitle,
            messages: [...newMessages, assistantMsg],
          });
          setIsLoading(false);
        },
        onError: (err) => {
          toast.error("回复失败");
          setIsLoading(false);
        },
      });
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative bg-background">
      {/* ✅ 传递新的 props */}
      <ChatHeader
        title={session.title}
        tokenStats={tokenStats}
        contextOptions={contextOptions}
        onContextOptionsChange={setContextOptions}
      />

      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-6 pb-4">
          {session.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <Avatar className="h-8 w-8 border shadow-sm mt-1">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <Bot className="w-4 h-4" />
                  </AvatarFallback>
                </Avatar>
              )}

              <div
                className={`relative max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border rounded-tl-sm"
                }`}
              >
                <FormattedMessage message={msg} />
              </div>

              {msg.role === "user" && (
                <Avatar className="h-8 w-8 border shadow-sm mt-1">
                  <AvatarFallback className="bg-secondary">
                    <User className="w-4 h-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4 justify-start">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  <Bot className="w-4 h-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-card border rounded-2xl px-5 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  正在思考...
                </span>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <div className="p-4 bg-background/80 backdrop-blur-md border-t">
        <div className="max-w-3xl mx-auto relative">
          <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/30 transition-all">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息... (Shift+Enter 换行)"
              className="min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent p-3 focus-visible:ring-0 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex justify-between items-center p-2 border-t bg-muted/20 rounded-b-xl">
              <div className="text-[10px] text-muted-foreground px-2">
                {input.length > 0 && `${estimateInputTokens(input)} tokens`}
              </div>
              <Button
                size="sm"
                className="h-8 px-3 gap-2"
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
              >
                发送 <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div className="text-[10px] text-center text-muted-foreground mt-2">
            AI 生成的内容可能不准确，请核实重要信息。
          </div>
        </div>
      </div>
    </div>
  );
};
