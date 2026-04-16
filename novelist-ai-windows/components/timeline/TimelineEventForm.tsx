import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAddTimelineEventMutation } from "@/lib/react-query/timeline.queries";
import { createTimelineEventSchema } from "@/lib/schemas";
import { useModalStore } from "@/stores/useModalStore";
import { MultiEntitySelector } from "../common/MultiEntitySelector";

interface TimelineEventFormProps {
  onClose: () => void;
  novelId: string;
}

/**
 * 时间线事件表单组件
 * 遵循单一职责原则，专注于时间线事件的创建和编辑
 * 使用 react-hook-form 和 zod 进行表单验证
 */
export const TimelineEventForm: React.FC<TimelineEventFormProps> = ({ onClose, novelId }) => {
  const addMutation = useAddTimelineEventMutation();

  const form = useForm<z.infer<typeof createTimelineEventSchema>>({
    resolver: zodResolver(createTimelineEventSchema),
    defaultValues: {
      novelId,
      title: "",
      description: "",
      dateDisplay: "",
      sortValue: 0,
      type: "plot",
      relatedEntityIds: [],
      relatedChapterId: "",
    },
  });

  const onSubmit = (data: z.infer<typeof createTimelineEventSchema>) => {
    addMutation.mutate(data, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  // 生成排序值的辅助函数
  const generateSortValue = (dateDisplay: string) => {
    // 简单的日期解析逻辑，可以根据实际需求扩展
    // 例如："帝国历 305 年" -> 30500
    const match = dateDisplay.match(/(\d+)/);
    if (match) {
      return parseInt(match[1]) * 100;
    }
    return Date.now(); // 如果无法解析，使用当前时间戳
  };

  const handleDateDisplayChange = (value: string) => {
    const sortValue = generateSortValue(value);
    form.setValue("dateDisplay", value);
    form.setValue("sortValue", sortValue);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>事件标题</FormLabel>
              <FormControl>
                <Input placeholder="输入事件标题" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dateDisplay"
          render={({ field }) => (
            <FormItem>
              <FormLabel>显示日期</FormLabel>
              <FormControl>
                <Input 
                  placeholder="例如：帝国历 305 年" 
                  {...field}
                  onChange={(e) => handleDateDisplayChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>事件类型</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择事件类型" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="plot">主线剧情</SelectItem>
                  <SelectItem value="backstory">背景设定</SelectItem>
                  <SelectItem value="historical">历史事件</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>事件描述</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="详细描述这个事件..." 
                  className="min-h-[100px]"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="relatedEntityIds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>关联实体 (参与者)</FormLabel>
              <FormControl>
                {/* ✅ 替换为智能多选器 */}
                <MultiEntitySelector
                  selectedIds={field.value || []}
                  onChange={field.onChange}
                  placeholder="选择参与此事件的角色或势力..."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="relatedChapterId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>关联章节（可选）</FormLabel>
              <FormControl>
                <Input placeholder="章节ID" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onClose}
            disabled={addMutation.isPending}
          >
            取消
          </Button>
          <Button 
            type="submit" 
            disabled={addMutation.isPending}
          >
            {addMutation.isPending ? "添加中..." : "添加事件"}
          </Button>
        </div>
      </form>
    </Form>
  );
};