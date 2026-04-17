'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';

const timelineEventSchema = z.object({
  title: z.string().min(1, '事件标题不能为空'),
  description: z.string().optional(),
  date: z.date().optional(),
  relatedCharacters: z.string().optional(),
  relatedChapters: z.string().optional(),
});

type TimelineEventData = z.infer<typeof timelineEventSchema>;

interface TimelineEventFormProps {
  onSubmit?: (data: TimelineEventData) => void;
  onCancel?: () => void;
  initialData?: Partial<TimelineEventData>;
}

export const TimelineEventForm: React.FC<TimelineEventFormProps> = ({
  onSubmit,
  onCancel,
  initialData,
}) => {
  const form = useForm<TimelineEventData>({
    resolver: zodResolver(timelineEventSchema),
    defaultValues: {
      title: initialData?.title || '',
      description: initialData?.description || '',
      relatedCharacters: initialData?.relatedCharacters || '',
      relatedChapters: initialData?.relatedChapters || '',
    },
  });
  const selectedDate = form.watch('date');

  const handleSubmit = (data: TimelineEventData) => {
    onSubmit?.(data);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">事件标题</Label>
        <Input id="title" placeholder="输入事件标题" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div>
        <Label>日期</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal',
                !selectedDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '选择日期'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => form.setValue('date', date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div>
        <Label htmlFor="description">事件描述</Label>
        <Textarea
          id="description"
          placeholder="描述这个事件的详细信息"
          className="resize-none"
          rows={3}
          {...form.register('description')}
        />
      </div>

      <div>
        <Label htmlFor="relatedCharacters">关联角色</Label>
        <Input
          id="relatedCharacters"
          placeholder="输入关联的角色ID（多个用逗号分隔）"
          {...form.register('relatedCharacters')}
        />
      </div>

      <div>
        <Label htmlFor="relatedChapters">关联章节</Label>
        <Input
          id="relatedChapters"
          placeholder="输入关联的章节ID（多个用逗号分隔）"
          {...form.register('relatedChapters')}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1">
          保存事件
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  );
};
