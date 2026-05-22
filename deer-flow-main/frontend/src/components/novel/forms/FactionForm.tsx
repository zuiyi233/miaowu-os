'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAddFactionMutation } from '@/core/novel/queries';

const factionFormSchema = z.object({
  name: z.string().min(1, '势力名不能为空'),
  description: z.string().optional(),
  ideology: z.string().optional(),
  leaderId: z.string().optional(),
  goals: z.string().optional(),
  structure: z.string().optional(),
  resources: z.string().optional(),
  relationships: z.string().optional(),
});

type FactionFormData = z.infer<typeof factionFormSchema>;

interface FactionFormProps {
  novelId: string;
  onSubmitSuccess?: () => void;
}

export const FactionForm: React.FC<FactionFormProps> = ({ novelId, onSubmitSuccess }) => {
  const addFaction = useAddFactionMutation(novelId);
  const form = useForm<FactionFormData>({
    resolver: zodResolver(factionFormSchema),
    defaultValues: {
      name: '',
      description: '',
      ideology: '',
      leaderId: '',
      goals: '',
      structure: '',
      resources: '',
      relationships: '',
    },
  });

  const onSubmit = (data: FactionFormData) => {
    const faction = {
      id: crypto.randomUUID(),
      ...data,
      leaderId: data.leaderId === 'none' ? '' : data.leaderId,
      novelId,
    };
    addFaction.mutate(faction as any, {
      onSuccess: () => {
        form.reset();
        onSubmitSuccess?.();
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">势力名</Label>
        <Input id="name" placeholder="请输入势力名称" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="ideology">理念/信仰</Label>
        <Textarea id="ideology" placeholder="理念/信仰" className="resize-none" rows={2} {...form.register('ideology')} />
      </div>

      <div>
        <Label htmlFor="description">描述</Label>
        <Textarea id="description" placeholder="势力描述" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="goals">目标与追求</Label>
        <Textarea id="goals" placeholder="目标与追求" className="resize-none" rows={2} {...form.register('goals')} />
      </div>

      <div>
        <Label htmlFor="structure">组织结构</Label>
        <Textarea id="structure" placeholder="组织结构" className="resize-none" rows={2} {...form.register('structure')} />
      </div>

      <div>
        <Label htmlFor="resources">资源与实力</Label>
        <Textarea id="resources" placeholder="资源与实力" className="resize-none" rows={2} {...form.register('resources')} />
      </div>

      <div>
        <Label htmlFor="relationships">对外关系</Label>
        <Textarea id="relationships" placeholder="对外关系" className="resize-none" rows={2} {...form.register('relationships')} />
      </div>

      <Button type="submit" className="w-full" disabled={addFaction.isPending}>
        {addFaction.isPending ? '保存中...' : '保存势力'}
      </Button>
    </form>
  );
};
