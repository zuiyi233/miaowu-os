import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Send,
  Eraser,
  Loader2,
  Bot,
  User,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Brain,
  BookOpen,
  MapPin,
  Shield,
  Gem,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { contextEngineService } from "@/services/contextEngineService";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { advancedStreamChat } from "@/services/llmService";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 消息接口定义
interface Message {
  role: "user" | "assistant";
  content: string;
  reasoning?: string; // 存储思考过程
  isThinking?: boolean; // 标记是否正在思考中
  contextEntities?: { type: string; name: string; id: string }[];
}

// ✅ 新增：平滑打字机 Hook
// 核心逻辑：将“网络接收的文本”和“屏幕显示的文本”解耦
const useTypewriter = (
  realText: string,
  isStreaming: boolean = false,
  speed: number = 20
) => {
  const [displayedText, setDisplayedText] = useState(
    isStreaming ? "" : realText
  );
  // 使用 ref 记录当前显示的长度，避免在 interval 中依赖过时的 state
  const currentLengthRef = useRef(isStreaming ? 0 : realText.length);

  useEffect(() => {
    // 如果不是流式传输（例如历史记录），直接显示全部
    if (!isStreaming) {
      setDisplayedText(realText);
      currentLengthRef.current = realText.length;
      return;
    }

    // 如果内容被清空或重置
    if (realText.length === 0) {
      setDisplayedText("");
      currentLengthRef.current = 0;
      return;
    }

    const intervalId = setInterval(() => {
      const currentLen = currentLengthRef.current;
      const targetLen = realText.length;

      if (currentLen < targetLen) {
        // ⚡️ 自适应速度算法：
        // 如果积压的字符很多（网络突然发来一大段），就加快打字速度
        // 如果积压很少，就保持平滑的逐字显示
        const distance = targetLen - currentLen;
        // 基础步进为1，每积压10个字符，步进+1，最大步进20
        const step = Math.min(20, Math.max(1, Math.floor(distance / 5)));

        const nextLen = currentLen + step;
        const nextText = realText.slice(0, nextLen);

        setDisplayedText(nextText);
        currentLengthRef.current = nextLen;
      }
    }, speed);

    return () => clearInterval(intervalId);
  }, [realText, isStreaming, speed]);

  return displayedText;
};

// 实体图标组件 (保持不变)
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

// 上下文引用指示器组件 (保持不变)
const ContextIndicator: React.FC<{ entities?: Message["contextEntities"] }> = ({
  entities,
}) => {
  if (!entities || entities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 mt-1 justify-end">
      <span className="text-[10px] text-muted-foreground flex items-center mr-1">
        <Sparkles className="w-3 h-3 mr-1" /> 已引用:
      </span>
      {entities.map((e, i) => (
        <Badge
          key={`${e.id}-${i}`}
          variant="outline"
          className="text-[10px] h-5 px-1.5 bg-background/50 gap-1 font-normal text-muted-foreground border-border/60"
        >
          <EntityIcon type={e.type} />
          {e.name}
        </Badge>
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
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full mb-3 border rounded-md bg-muted/30 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full flex items-center justify-between px-3 py-2 h-8 text-xs text-muted-foreground hover:bg-muted/50"
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
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 py-2 text-xs text-muted-foreground/80 leading-relaxed border-t border-border/50 bg-muted/20 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
          {content}
          {isThinking && (
            <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-primary/50 animate-pulse" />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// 格式化消息组件
const FormattedMessage: React.FC<{
  message: Message;
  isStreaming?: boolean; // ✅ 新增：接收流式状态
}> = ({ message, isStreaming = false }) => {
  const { content, role, reasoning, isThinking } = message;

  // 1. 分离思考内容和正文内容
  const { rawThought, rawMainContent, thinkingState } = useMemo(() => {
    if (role === "user")
      return { rawThought: "", rawMainContent: content, thinkingState: false };

    // 优先使用结构化的 reasoning 字段
    if (reasoning || isThinking) {
      return {
        rawThought: reasoning || "",
        rawMainContent: content,
        thinkingState: isThinking || false,
      };
    }

    // 后备逻辑：解析 content 中的 <think> 标签
    const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    if (thinkMatch) {
      const thoughtContent = thinkMatch[1];
      const hasClosedTag = content.includes("</think>");
      const cleanContent = content
        .replace(/<think>[\s\S]*?(?:<\/think>|$)/, "")
        .trim();

      return {
        rawThought: thoughtContent,
        rawMainContent: cleanContent,
        thinkingState: !hasClosedTag,
      };
    }

    return { rawThought: "", rawMainContent: content, thinkingState: false };
  }, [content, role, reasoning, isThinking]);

  // ✅ 2. 应用打字机效果
  // 只有当 isStreaming 为 true 时，才启用打字机效果
  // 思考过程和正文分别使用独立的打字机 Hook
  const displayThought = useTypewriter(rawThought, isStreaming && !!rawThought);
  const displayContent = useTypewriter(
    rawMainContent,
    isStreaming && !!rawMainContent
  );

  return (
    <div className="w-full min-w-0">
      {role === "user" && (
        <ContextIndicator entities={message.contextEntities} />
      )}

      {/* 助手消息：显示思考过程 */}
      {role === "assistant" && (displayThought || thinkingState) && (
        <ThinkingProcess content={displayThought} isThinking={thinkingState} />
      )}

      {/* 助手消息：显示正文 */}
      {(displayContent || (!displayThought && !thinkingState)) && (
        <div className="text-sm leading-relaxed break-words">
          {role === "user" ? (
            <div className="whitespace-pre-wrap">{displayContent}</div>
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
                {displayContent}
              </ReactMarkdown>
            </div>
          )}

          {/* 光标闪烁效果：仅在流式传输且内容尚未完全显示时显示 */}
          {role === "assistant" && isStreaming && (
            <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse align-middle ml-1" />
          )}
        </div>
      )}
    </div>
  );
};

export const AiChatView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "你好！我是你的写作助手。我们可以聊聊你的小说设定、剧情走向，或者对当前世界观进行头脑风暴。",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatModel = useSettingsStore(
    (s) => s.modelSettings?.chat?.model || "gpt-4o-mini"
  );

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]); // 依赖 messages 变化自动滚动

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput("");

    // 添加用户消息
    const tempUserMsg: Message = { role: "user", content: userMsg };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    try {
      let finalPrompt = userMsg;
      let usedEntities: Message["contextEntities"] = [];

      // 上下文增强逻辑
      if (useContext) {
        try {
          const result = await contextEngineService.analyzeContext(userMsg);

          if (result.prompt !== userMsg) {
            finalPrompt = result.prompt;
            usedEntities = result.usedEntities;

            setMessages((prev) => {
              const newMsgs = [...prev];
              const lastMsg = newMsgs[newMsgs.length - 1];
              if (lastMsg.role === "user") {
                newMsgs[newMsgs.length - 1] = {
                  ...lastMsg,
                  contextEntities: usedEntities,
                };
              }
              return newMsgs;
            });
          }
        } catch (e) {
          console.warn("Context injection failed", e);
        }
      }

      const history = messages
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: finalPrompt });

      let assistantContent = "";
      let assistantReasoning = "";
      let hasAddedAssistantMsg = false;

      const ensureAssistantMsg = () => {
        if (!hasAddedAssistantMsg) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "",
              reasoning: "",
              isThinking: false,
            },
          ]);
          hasAddedAssistantMsg = true;
        }
      };

      await advancedStreamChat(history, {
        onMessage: (chunk) => {
          ensureAssistantMsg();
          assistantContent += chunk;
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastIndex = newMsgs.length - 1;
            newMsgs[lastIndex] = {
              ...newMsgs[lastIndex],
              content: assistantContent,
            };
            return newMsgs;
          });
        },
        onReasoning: (chunk) => {
          ensureAssistantMsg();
          assistantReasoning += chunk;
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastIndex = newMsgs.length - 1;
            newMsgs[lastIndex] = {
              ...newMsgs[lastIndex],
              reasoning: assistantReasoning,
            };
            return newMsgs;
          });
        },
        onThinking: (thinking) => {
          ensureAssistantMsg();
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastIndex = newMsgs.length - 1;
            newMsgs[lastIndex] = {
              ...newMsgs[lastIndex],
              isThinking: thinking,
            };
            return newMsgs;
          });
        },
        onFinish: () => {
          if (!hasAddedAssistantMsg) {
            ensureAssistantMsg();
          }
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastIndex = newMsgs.length - 1;
            newMsgs[lastIndex] = {
              ...newMsgs[lastIndex],
              isThinking: false,
            };
            return newMsgs;
          });
          setIsLoading(false);
        },
        onError: (error) => {
          console.error(error);
          setIsLoading(false);
        },
      });
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("对话失败", {
        description:
          error instanceof Error ? error.message : "请检查 API 配置和网络连接",
      });
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([
      {
        role: "assistant",
        content:
          "你好！我是你的写作助手。我们可以聊聊你的小说设定、剧情走向，或者对当前世界观进行头脑风暴。",
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 pr-2 mb-4">
        <div className="space-y-6 p-2">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex gap-3 ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role === "assistant" && (
                <Avatar className="h-8 w-8 mt-1 border shadow-sm">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}

              <div
                className={`relative max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border rounded-tl-sm"
                }`}
              >
                {/* ✅ 关键：传递 isStreaming 属性 */}
                {/* 只有当正在加载，且当前是最后一条消息，且角色是助手时，才启用流式打字机效果 */}
                <FormattedMessage
                  message={message}
                  isStreaming={
                    isLoading &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              </div>

              {message.role === "user" && (
                <Avatar className="h-8 w-8 mt-1 border shadow-sm">
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {/* 加载状态指示器 - 仅在等待第一个字节时显示 */}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Avatar className="h-8 w-8 mt-1">
                <AvatarFallback className="bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-card border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  AI 正在思考中...
                </span>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <Card className="p-4 bg-card border-t shadow-up-sm z-10">
        {/* 输入框区域保持不变 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              自由对话
            </span>
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-2 bg-muted/50 border-border/50"
            >
              {chatModel}
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="use-context"
                checked={useContext}
                onCheckedChange={setUseContext}
                className="scale-75"
              />
              <Label htmlFor="use-context" className="text-xs cursor-pointer">
                上下文增强
              </Label>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={handleClear}
              disabled={messages.length <= 1}
              title="清空对话"
            >
              <Eraser className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题或想法... (Shift+Enter 换行)"
            className="min-h-[80px] resize-none bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary/30 border-border/60"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-10 w-10 mb-1 shrink-0 shadow-sm"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
};
