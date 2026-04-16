'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAddVolumeMutation } from '@/core/novel/queries';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const volumeFormSchema = z.object({
  title: z.string().min(1, '卷标题不能为空'),
  description: z.string().optional(),
});

type VolumeFormData = z.infer<typeof volumeFormSchema>;

interface VolumeFormProps {
  novelId: string;
  onSubmitSuccess?: () => void;
}

export const VolumeForm: React.FC<VolumeFormProps> = ({ novelId, onSubmitSuccess }) => {
  const addVolume = useAddVolumeMutation(novelId);
  const form = useForm<VolumeFormData>({
    resolver: zodResolver(volumeFormSchema),
    defaultValues: { title: '', description: '' },
  });

  const onSubmit = (data: VolumeFormData) => {
    const volume = {
      id: crypto.randomUUID(),
      ...data,
      novelId,
      order: 0,
      chapters: [],
    };
    addVolume.mutate(volume as any, {
      onSuccess: () => {
        form.reset();
        onSubmitSuccess?.();
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">卷标题</Label>
        <Input id="title" placeholder="例如：第一卷：序章" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
        )}
      </div>
      <div>
        <Label htmlFor="description">卷描述（可选）</Label>
        <Textarea id="description" placeholder="卷的简介或概述..." className="resize-none" rows={3} {...form.register('description')} />
      </div>
      <Button type="submit" className="w-full" disabled={addVolume.isPending}>
        {addVolume.isPending ? '创建中...' : '创建卷'}
      </Button>
    </form>
  );
};
