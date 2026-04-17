'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAddChapterMutation } from '@/core/novel/queries';

const chapterFormSchema = z.object({
  title: z.string().min(1, '章节标题不能为空'),
  description: z.string().optional(),
  volumeId: z.string().optional(),
});

type ChapterFormData = z.infer<typeof chapterFormSchema>;

interface ChapterFormProps {
  novelId: string;
  volumeId?: string;
  onSubmitSuccess?: () => void;
}

export const ChapterForm: React.FC<ChapterFormProps> = ({ novelId, volumeId, onSubmitSuccess }) => {
  const addChapter = useAddChapterMutation(novelId);
  const form = useForm<ChapterFormData>({
    resolver: zodResolver(chapterFormSchema),
    defaultValues: { title: '', description: '', volumeId: volumeId || '' },
  });

  const onSubmit = (data: ChapterFormData) => {
    const chapter = {
      id: crypto.randomUUID(),
      ...data,
      content: '',
      novelId,
      order: 0,
    };
    addChapter.mutate({ chapter: chapter as any, volumeId: data.volumeId || undefined }, {
      onSuccess: () => {
        form.reset();
        onSubmitSuccess?.();
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">章节标题</Label>
        <Input id="title" placeholder="请输入章节标题" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
        )}
      </div>
      <div>
        <Label htmlFor="description">章节描述</Label>
        <Textarea id="description" placeholder="章节简介或概述..." className="resize-none" rows={3} {...form.register('description')} />
      </div>
      <Button type="submit" className="w-full" disabled={addChapter.isPending}>
        {addChapter.isPending ? '创建中...' : '创建章节'}
      </Button>
    </form>
  );
};
