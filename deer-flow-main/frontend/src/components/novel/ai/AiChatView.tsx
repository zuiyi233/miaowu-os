'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import { useAiPanelStore } from '@/core/novel';
import { novelAiService } from '@/core/novel/ai-service';
import { useI18n } from '@/core/i18n/hooks';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AiChatView({ novelId }: { novelId: string }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const { t } = useI18n();
  const aiStream = useAiPanelStore((s) => s.aiStream);
  const selectedText = useAiPanelStore((s) => s.selectedText);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userInput = input.trim();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const assistantMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ]);
    setIsSending(true);

    try {
      await novelAiService.chat(
        {
          messages: [
            {
              role: 'system',
              content: `你是小说创作助手。当前小说ID：${novelId}。请给出简洁、可执行建议。`,
            },
            {
              role: 'user',
              content: selectedText
                ? `选中文本：${selectedText}\n\n用户问题：${userInput}`
                : userInput,
            },
          ],
          novelId,
          stream: true,
        },
        {
          onChunk: (chunk) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: `${msg.content}${chunk}` }
                  : msg
              )
            );
          },
          onError: () => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: 'AI 请求失败，请稍后重试。' }
                  : msg
              )
            );
          },
        }
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {selectedText && (
        <div className="border-b p-2 text-xs text-muted-foreground">
          {t.novel.selectedText}: {selectedText.slice(0, 100)}...
        </div>
      )}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 && aiStream.isStreaming ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {t.novel.aiThinking}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.novel.typeMessage}
            className="min-h-[40px] resize-none"
            disabled={isSending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim() || isSending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
