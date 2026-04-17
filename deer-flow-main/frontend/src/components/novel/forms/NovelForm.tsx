'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateNovelMutation } from '@/core/novel/queries';
import type { Novel } from '@/core/novel/schemas';

const novelFormSchema = z.object({
  title: z.string().min(1, '小说标题不能为空'),
  description: z.string().optional(),
  author: z.string().optional(),
  genre: z.string().optional(),
  coverImage: z.string().optional(),
});

type NovelFormData = z.infer<typeof novelFormSchema>;

interface NovelFormProps {
  onSubmitSuccess?: () => void;
  initialData?: Novel;
}

export const NovelForm: React.FC<NovelFormProps> = ({ onSubmitSuccess, initialData }) => {
  const updateNovel = useUpdateNovelMutation();
  const form = useForm<NovelFormData>({
    resolver: zodResolver(novelFormSchema),
    defaultValues: {
      title: initialData?.title || '',
      description: initialData?.description || '',
      author: (initialData as any)?.author || '',
      genre: (initialData as any)?.genre || '',
      coverImage: (initialData as any)?.coverImage || '',
    },
  });

  const onSubmit = (data: NovelFormData) => {
    if (initialData) {
      updateNovel.mutate(
        { novelId: initialData.id, updates: { ...data, id: initialData.id } as any },
        { onSuccess: () => onSubmitSuccess?.() }
      );
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">小说标题</Label>
        <Input id="title" placeholder="请输入小说标题" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="author">作者</Label>
        <Input id="author" placeholder="作者名称" {...form.register('author')} />
      </div>

      <div>
        <Label htmlFor="genre">类型</Label>
        <Input id="genre" placeholder="例如：玄幻、都市、历史" {...form.register('genre')} />
      </div>

      <div>
        <Label htmlFor="description">简介</Label>
        <Textarea id="description" placeholder="小说简介" className="resize-none" rows={4} {...form.register('description')} />
      </div>

      <Button type="submit" className="w-full" disabled={updateNovel.isPending}>
        {updateNovel.isPending ? '保存中...' : initialData ? '更新' : '创建'}
      </Button>
    </form>
  );
};
