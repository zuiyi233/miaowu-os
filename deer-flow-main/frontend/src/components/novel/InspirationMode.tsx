'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send, ArrowLeft, RefreshCcw, Sparkles, Loader2, RotateCcw, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

import { novelApiService } from '@/core/novel/novel-api';
import type { InspirationOption, InspirationWizardData } from '@/core/novel/schemas';
import { AIProjectGenerator } from './AIProjectGenerator';
import type { GenerationConfig } from './AIProjectGenerator';

type Step = 'idea' | 'title' | 'description' | 'theme' | 'genre' | 'perspective' | 'outline_mode' | 'confirm';

interface Message {
  type: 'ai' | 'user';
  content: string;
  options?: string[];
  isMultiSelect?: boolean;
  canRefine?: boolean;
  step?: Step;
}

const STEP_ORDER: Step[] = ['idea', 'title', 'description', 'theme', 'genre', 'perspective', 'outline_mode', 'confirm'];

export function InspirationMode() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>('idea');
  const [wizardData, setWizardData] = useState<InspirationWizardData>({
    title: '', description: '', theme: '', genre: [], narrativePerspective: '', outlineMode: 'one-to-one',
  });
  const [showRefine, setShowRefine] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      const cached = localStorage.getItem('inspiration_conversation_cache');
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
          setMessages(data.messages || []);
          setCurrentStep(data.currentStep || 'idea');
          setWizardData(data.wizardData || wizardData);
        }
      }
    } catch {}
  }, []);

  const saveCache = useCallback((msgs: Message[], step: Step, data: InspirationWizardData) => {
    localStorage.setItem('inspiration_conversation_cache', JSON.stringify({
      messages: msgs, currentStep: step, wizardData: data, timestamp: Date.now(),
    }));
  }, []);

  const generateOptions = useCallback(async (step: Step, context: string): Promise<string[]> => {
    const res = await novelApiService.generateInspirationOptions(step, { idea: context });
    return res.options;
  }, []);

  const addAIMessage = useCallback((content: string, step?: Step, options?: string[], isMultiSelect?: boolean, canRefine?: boolean) => {
    const msg: Message = { type: 'ai' as const, content, options, isMultiSelect, canRefine, step };
    setMessages((prev) => {
      const newMsgs = [...prev, msg];
      saveCache(newMsgs, currentStep, wizardData);
      return newMsgs;
    });
  }, [currentStep, wizardData, saveCache]);

  const addUserMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { type: 'user', content }]);
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    addUserMessage(text);
    setInputValue('');
    setIsLoading(true);
    setSelectedOptions(new Set());
    setShowRefine(false);

    try {
      switch (currentStep) {
        case 'idea': {
          const options = await generateOptions('title', text);
          setCurrentStep('title');
          setMessages((prev) => [...prev, { type: 'ai', content: `太棒了！基于"${text}"的想法，我为你生成了几个书名选项：`, options, step: 'title', canRefine: true }]);
          break;
        }
        case 'title': {
          const options = await generateOptions('description', text);
          setCurrentStep('description');
          setWizardData((d) => ({ ...d, title: text }));
          setMessages((prev) => [...prev, { type: 'ai', content: `书名"${text}"已确认！接下来生成简介：`, options, step: 'description', canRefine: true }]);
          break;
        }
        case 'description': {
          const options = await generateOptions('theme', text);
          setCurrentStep('theme');
          setWizardData((d) => ({ ...d, description: text }));
          setMessages((prev) => [...prev, { type: 'ai', content: `简介已记录！现在选择核心主题：`, options, step: 'theme', canRefine: true }]);
          break;
        }
        case 'theme': {
          const options = await generateOptions('genre', text);
          setCurrentStep('genre');
          setWizardData((d) => ({ ...d, theme: text }));
          setMessages((prev) => [...prev, { type: 'ai', content: `主题"${text}"已确定！请选择小说类型（可多选）：`, options, step: 'genre', isMultiSelect: true, canRefine: true }]);
          break;
        }
        case 'genre': {
          const options = await generateOptions('perspective', text);
          setCurrentStep('perspective');
          setWizardData((d) => ({ ...d, genre: [text] }));
          setMessages((prev) => [...prev, { type: 'ai', content: `类型已选！接下来是叙事视角：`, options, step: 'perspective', canRefine: true }]);
          break;
        }
        case 'perspective': {
          const options = await generateOptions('outline_mode', text);
          setCurrentStep('outline_mode');
          setWizardData((d) => ({ ...d, narrativePerspective: text }));
          setMessages((prev) => [...prev, { type: 'ai', content: `视角"${text}"已设定！最后选择大纲模式：`, options, step: 'outline_mode', canRefine: true }]);
          break;
        }
        case 'outline_mode': {
          setCurrentStep('confirm');
          setWizardData((d) => ({ ...d, outlineMode: text === '一对一' ? 'one-to-one' : 'one-to-many' }));
          const summary = [
            `📖 书名: ${wizardData.title}`,
            `📝 简介: ${wizardData.description}`,
            `🎨 主题: ${wizardData.theme}`,
            `🏷️ 类型: ${wizardData.genre.join(', ')}`,
            `👁️ 视角: ${wizardData.narrativePerspective}`,
            `📋 大纲模式: ${text}`,
          ].join('\n');
          setMessages((prev) => [...prev, { type: 'ai', content: `所有信息已收集完毕！\n\n${summary}\n\n确认创建项目吗？`, step: 'confirm' }]);
          break;
        }
        default:
          break;
      }
    } catch {
      toast.error('AI响应失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [currentStep, inputValue, isLoading, wizardData, generateOptions, addUserMessage]);

  const handleOptionSelect = useCallback(async (option: string) => {
    if (currentStep === 'genre') {
      const next = new Set(selectedOptions);
      if (next.has(option)) next.delete(option); else next.add(option);
      setSelectedOptions(next);
      return;
    }

    addUserMessage(option);
    setIsLoading(true);
    setShowRefine(false);

    try {
      switch (currentStep) {
        case 'title': {
          const options = await generateOptions('description', option);
          setCurrentStep('description');
          setWizardData((d) => ({ ...d, title: option }));
          setMessages((prev) => [...prev, { type: 'ai', content: `书名"${option}"已确认！接下来生成简介：`, options, step: 'description', canRefine: true }]);
          break;
        }
        case 'description': {
          const options = await generateOptions('theme', option);
          setCurrentStep('theme');
          setWizardData((d) => ({ ...d, description: option }));
          setMessages((prev) => [...prev, { type: 'ai', content: `简介已记录！现在选择核心主题：`, options, step: 'theme', canRefine: true }]);
          break;
        }
        case 'theme': {
          const options = await generateOptions('genre', option);
          setCurrentStep('genre');
          setWizardData((d) => ({ ...d, theme: option }));
          setMessages((prev) => [...prev, { type: 'ai', content: `主题"${option}"已确定！请选择小说类型（可多选）：`, options, step: 'genre', isMultiSelect: true, canRefine: true }]);
          break;
        }
        case 'perspective': {
          const options = await generateOptions('outline_mode', option);
          setCurrentStep('outline_mode');
          setWizardData((d) => ({ ...d, narrativePerspective: option }));
          setMessages((prev) => [...prev, { type: 'ai', content: `视角"${option}"已设定！最后选择大纲模式：`, options, step: 'outline_mode', canRefine: true }]);
          break;
        }
        case 'outline_mode': {
          setCurrentStep('confirm');
          setWizardData((d) => ({ ...d, outlineMode: option === '一对一' ? 'one-to-one' : 'one-to-many' }));
          const summary = [
            `📖 书名: ${wizardData.title}`,
            `📝 简介: ${wizardData.description}`,
            `🎨 主题: ${wizardData.theme}`,
            `🏷️ 类型: ${wizardData.genre.join(', ')}`,
            `👁️ 视角: ${wizardData.narrativePerspective}`,
            `📋 大纲模式: ${option}`,
          ].join('\n');
          setMessages((prev) => [...prev, { type: 'ai', content: `所有信息已收集完毕！\n\n${summary}\n\n确认创建项目吗？`, step: 'confirm' }]);
          break;
        }
        default:
          break;
      }
    } catch {
      toast.error('AI响应失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [currentStep, selectedOptions, wizardData, generateOptions, addUserMessage]);

  const handleConfirmGenre = async () => {
    if (selectedOptions.size === 0) return;
    addUserMessage(Array.from(selectedOptions).join(', '));
    setIsLoading(true);
    setSelectedOptions(new Set());
    setShowRefine(false);
    try {
      const options = await generateOptions('perspective', Array.from(selectedOptions).join(', '));
      setCurrentStep('perspective');
      setWizardData((d) => ({ ...d, genre: Array.from(selectedOptions) }));
      setMessages((prev) => [...prev, { type: 'ai', content: `类型已选！接下来是叙事视角：`, options, step: 'perspective', canRefine: true }]);
    } catch { toast.error('AI响应失败'); }
    finally { setIsLoading(false); }
  };

  const handleConfirmCreate = () => {
    setIsGenerating(true);
    setMessages((prev) => [...prev, { type: 'ai', content: `✅ 配置已确认！正在启动AI项目生成流程...\n\n《${wizardData.title}》即将诞生，请稍候。` }]);
    localStorage.removeItem('inspiration_conversation_cache');
  };

  const buildGenerationConfig = (): GenerationConfig | null => {
    if (!wizardData.title) return null;
    return {
      title: wizardData.title,
      description: wizardData.description,
      theme: wizardData.theme,
      genre: wizardData.genre,
      narrative_perspective: wizardData.narrativePerspective,
      target_words: 50000,
      chapter_count: 30,
      character_count: 5,
      outline_mode: wizardData.outlineMode || 'one-to-many',
    };
  };

  const handleRestart = () => {
    setMessages([]);
    setInputValue('');
    setSelectedOptions(new Set());
    setCurrentStep('idea');
    setWizardData({ title: '', description: '', theme: '', genre: [], narrativePerspective: '', outlineMode: 'one-to-one' });
    setShowRefine(false);
    setRefineText('');
    setIsGenerating(false);
    localStorage.removeItem('inspiration_conversation_cache');
  };

  const handleRefine = async () => {
    if (!refineText.trim()) return;
    setIsLoading(true);
    setShowRefine(false);
    try {
      const prevOptions = messages.slice(-4).flatMap(m => m.options ?? []);
      const res = await novelApiService.refineInspirationOptions(currentStep, { idea: '' }, refineText, prevOptions);
      setMessages((prev) => [...prev, { type: 'ai' as const, content: '根据你的反馈，我重新生成了以下选项：', options: res.options, step: currentStep, canRefine: true }]);
      setRefineText('');
    } catch { toast.error('优化失败'); }
    finally { setIsLoading(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stepIndex = STEP_ORDER.indexOf(currentStep);

  const generationConfig = buildGenerationConfig();

  if (isGenerating && generationConfig) {
    return (
      <div className="flex h-full flex-col bg-background">
        <AIProjectGenerator
          config={generationConfig}
          storagePrefix="inspiration"
          onComplete={(projectId) => {
            toast.success(`🎉 项目《${wizardData.title}》生成完成！`);
          }}
          onBack={() => setIsGenerating(false)}
          isMobile={isMobile}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <h1 className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5 text-primary" />灵感模式</h1>
        {currentStep !== 'idea' && (
          <Button variant="ghost" size="sm" onClick={handleRestart}><RotateCcw className="h-4 w-4 mr-1" />重新开始</Button>
        )}
        {!currentStep || currentStep === 'idea' ? <div /> : null}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="mx-auto max-w-[800px] space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Sparkles className="h-16 w-16 mb-4 opacity-20" />
              <p className="text-lg font-medium">开始你的创作之旅</p>
              <p className="text-sm mt-1">描述你想要创作的想法，AI将引导你一步步完善</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.type === 'user' ? "justify-end" : "justify-start")}>
              <Card className={cn("max-w-[85%]", msg.type === 'user' ? "bg-primary text-primary-foreground" : "")}>
                <CardContent className={cn("p-3", msg.type === 'user' ? "" : "")}>
                  <p className={cn("whitespace-pre-wrap leading-relaxed", msg.type === 'user' ? "" : "text-sm")}>{msg.content}</p>

                  {msg.options && msg.options.length > 0 && (
                    <div className={cn("mt-3 grid gap-2", msg.isMultiSelect ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1")}>
                      {msg.options.map((opt, j) => (
                        <button
                          key={j}
                          disabled={isLoading}
                          onClick={() => msg.isMultiSelect ? handleOptionSelect(opt) : handleOptionSelect(opt)}
                          className={cn(
                            "rounded-md border px-3 py-2 text-left text-sm transition-all",
                            msg.isMultiSelect && selectedOptions.has(opt)
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-primary/50 hover:bg-accent",
                          )}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.isMultiSelect && selectedOptions.size > 0 && (
                    <Button size="sm" className="mt-3" onClick={handleConfirmGenre}>确认选择</Button>
                  )}

                  {msg.canRefine && !showRefine && (
                    <button
                      className="mt-2 text-xs text-muted-foreground underline cursor-pointer hover:text-primary"
                      onClick={() => setShowRefine(true)}
                    >
                      不太满意？告诉我你的偏好 →
                    </button>
                  )}

                  {showRefine && i === messages.length - 1 && (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        rows={2}
                        placeholder="描述你希望调整的方向..."
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleRefine())}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setShowRefine(false)}>取消</Button>
                        <Button size="sm" onClick={handleRefine} disabled={!refineText.trim()}><RefreshCcw className="h-3 w-3 mr-1" />重新生成</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <Card><CardContent className="p-3"><div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /><span className="text-sm">思考中...</span></div></CardContent></Card>
            </div>
          )}

          {currentStep === 'confirm' && !isLoading && messages.length > 0 && (messages.at(-1)?.step === 'confirm') && (
            <div className="flex gap-3 pt-2">
              <Button onClick={handleConfirmCreate}><Sparkles className="h-4 w-4 mr-1" />确认创建</Button>
              <Button variant="outline" onClick={handleRestart}>重新开始</Button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t p-4">
        <div className="mx-auto max-w-[800px] flex gap-2">
          <Textarea
            placeholder={
              currentStep === 'idea'
                ? '描述你想写的故事...'
                : currentStep === 'title'
                ? '输入自定义书名或从上方选择...'
                : currentStep === 'genre'
                ? '输入自定义类型或从上方选择多个...'
                : '输入自定义内容或从上方选择...'
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={isMobile ? 2 : 1}
            className="resize-none"
            disabled={isLoading}
          />
          <Button onClick={handleSend} disabled={!inputValue.trim() || isLoading} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mx-auto max-w-[800px] text-[11px] text-muted-foreground mt-1.5">
          Enter 发送 · Shift+Enter 换行 · 当前步骤：{STEP_ORDER[stepIndex]} ({stepIndex + 1}/{STEP_ORDER.length})
        </p>
      </div>
    </div>
  );
}
