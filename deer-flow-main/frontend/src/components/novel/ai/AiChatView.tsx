'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import { useAiPanelStore } from '@/core/novel';
import { useI18n } from '@/core/i18n/hooks';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AiChatView() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const { t } = useI18n();
  const aiStream = useAiPanelStore((s) => s.aiStream);
  const selectedText = useAiPanelStore((s) => s.selectedText);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
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
            {aiStream.isStreaming && aiStream.latestChunk && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">
                  {aiStream.latestChunk}
                </div>
              </div>
            )}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
