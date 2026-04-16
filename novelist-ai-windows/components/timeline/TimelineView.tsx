import React, { useState } from "react";
import { useTimelineEventsQuery, useDeleteTimelineEventMutation } from "@/lib/react-query/timeline.queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Calendar, Clock, Sparkles, Loader2 } from "lucide-react";
import { useModalStore } from "@/stores/useModalStore";
import { TimelineEventForm } from "./TimelineEventForm"; // 基于useMutationForm实现的简单表单
import { useNovelDataSelector } from "@/lib/react-query/novel.queries";
import { toast } from "sonner";
// ✅ 引入生成服务
import { generateTimeline } from "@/services/llmService";
// ✅ 引入添加事件 Mutation
import { useAddTimelineEventMutation } from "@/lib/react-query/timeline.queries";

/**
 * 时间线视图组件
 * 遵循单一职责原则，专注于时间线事件的展示和管理
 * 提供直观的时间线界面，支持事件的添加、查看和删除
 */
export const TimelineView: React.FC = () => {
  const { data: events = [], isLoading } = useTimelineEventsQuery();
  const deleteMutation = useDeleteTimelineEventMutation();
  const { open } = useModalStore();
  const novelData = useNovelDataSelector((n) => n);
  const addEventMutation = useAddTimelineEventMutation(); // 事件写入 Hook
  const [isGenerating, setIsGenerating] = useState(false); // 生成状态
  
  // 🎯 真正的 AI 时间线生成功能实现
  const handleAiGenerateTimeline = async () => {
    if (!novelData.data) {
      toast.error("无法获取小说数据");
      return;
    }

    // 1. 获取文本来源：优先使用小说大纲
    const outline = novelData.data.outline || "";
    
    if (!outline || outline.length < 10) {
      toast.warning("小说大纲内容太少", {
        description: "AI 需要基于大纲来梳理时间线。请先在设置或首页完善小说大纲。"
      });
      return;
    }

    setIsGenerating(true);
    const toastId = toast.loading("AI 正在梳理历史长河...", { description: "正在分析大纲中的时间节点" });

    try {
      // 2. 调用 LLM 服务生成时间线
      const events = await generateTimeline(outline);

      if (!events || events.length === 0) {
        toast.info("AI 未能从大纲中提取出明确的时间节点", { id: toastId });
        return;
      }

      let addedCount = 0;

      // 3. 遍历结果并写入数据库
      const promises = events.map(async (evt: any) => {
        // 简单的校验
        if (evt.title && evt.dateDisplay) {
           try {
             await addEventMutation.mutateAsync({
               novelId: novelData.data!.title, // 确保 novelId 存在
               title: evt.title,
               description: evt.description || "",
               dateDisplay: evt.dateDisplay,
               sortValue: typeof evt.sortValue === 'number' ? evt.sortValue : Date.now(),
               type: ["plot", "backstory", "historical"].includes(evt.type) ? evt.type : "plot",
               relatedEntityIds: [], // AI 初步生成通常很难精确匹配 ID，留空让用户后续关联
               relatedChapterId: ""
             });
             addedCount++;
           } catch (e) {
             console.warn("Failed to add event", evt, e);
           }
        }
      });

      await Promise.all(promises);

      toast.success(`成功生成了 ${addedCount} 个历史事件`, { id: toastId });
      
    } catch (error) {
      console.error("AI 生成时间线失败:", error);
      toast.error("AI 生成失败", {
        id: toastId,
        description: (error as Error).message
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAdd = () => {
    if (!novelData.data?.title) {
      toast.error("无法获取小说标题，请先选择小说");
      return;
    }

    open({
      type: "dialog",
      title: "添加历史事件",
      component: TimelineEventForm,
      props: {
        novelId: novelData.data.title,
      },
    });
  };

  // 获取事件类型的显示名称和样式
  const getEventTypeDisplay = (type: string) => {
    switch (type) {
      case 'backstory':
        return { label: '背景设定', variant: 'secondary' as const, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' };
      case 'plot':
        return { label: '主线剧情', variant: 'default' as const, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
      case 'historical':
        return { label: '历史事件', variant: 'outline' as const, className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' };
      default:
        return { label: type, variant: 'default' as const, className: '' };
    }
  };

  if (isLoading) return <div className="p-8 text-center">加载历史长河...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
         <div>
            <h2 className="text-2xl font-bold font-['Lora']">历史长河 (Timeline)</h2>
            <p className="text-muted-foreground text-sm">梳理故事的时间脉络与大事件</p>
         </div>
         <Button onClick={handleAdd}>
           <Plus className="mr-2 w-4 h-4"/> 添加事件
         </Button>
      </div>
      
      {events.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-6">暂无事件，记录下第一个历史时刻吧。</p>
              
              {/* 🎯 智能空状态引导 - AI 生成时间线 */}
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  或者让 AI 帮你根据小说大纲自动生成时间线
                </div>
                <Button
                  variant="outline"
                  onClick={handleAiGenerateTimeline}
                  disabled={isGenerating}
                  className="gap-2"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isGenerating ? "生成中..." : "AI 生成时间线"}
                </Button>
              </div>
          </div>
      ) : (
          <div className="relative border-l-2 border-primary/20 ml-4 space-y-8 pb-12">
            {events.map((event, index) => {
              const eventType = getEventTypeDisplay(event.type);
              return (
                <div key={event.id} className="relative pl-8 group">
                  {/* 时间轴节点 */}
                  <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-background border-4 border-primary transition-all group-hover:scale-125" />
                  
                  <Card className="p-4 hover:shadow-md transition-all border-l-4 border-l-transparent hover:border-l-primary">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex gap-2 items-center">
                          <Badge variant="outline" className="font-mono">{event.dateDisplay}</Badge>
                          <Badge variant={eventType.variant} className={eventType.className}>
                            {eventType.label}
                          </Badge>
                      </div>
                      <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(event.id)}
                          disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <h3 className="text-lg font-bold mb-1">{event.title}</h3>
                    {event.description && (
                      <p className="text-sm text-muted-foreground leading-relaxed">{event.description}</p>
                    )}
                    
                    {/* 显示关联实体 */}
                    {event.relatedEntityIds && event.relatedEntityIds.length > 0 && (
                      <div className="mt-3 flex items-center gap-2">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          关联 {event.relatedEntityIds.length} 个实体
                        </span>
                      </div>
                    )}
                  </Card>
                </div>
              );
            })}
          </div>
      )}
    </div>
  );
};