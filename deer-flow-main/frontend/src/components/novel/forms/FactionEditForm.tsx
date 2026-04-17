'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateFactionMutation, useDeleteFactionMutation } from '@/core/novel/queries';
import type { Faction } from '@/core/novel/schemas';

const factionEditSchema = z.object({
  name: z.string().min(1, '势力名不能为空'),
  description: z.string().optional(),
  ideology: z.string().optional(),
  leaderId: z.string().optional(),
  goals: z.string().optional(),
  structure: z.string().optional(),
  resources: z.string().optional(),
  relationships: z.string().optional(),
});

type FactionEditData = z.infer<typeof factionEditSchema>;

interface FactionEditFormProps {
  faction: Faction;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const FactionEditForm: React.FC<FactionEditFormProps> = ({
  faction,
  onSubmitSuccess,
  onDelete,
}) => {
  const updateFaction = useUpdateFactionMutation();
  const deleteFaction = useDeleteFactionMutation();
  const form = useForm<FactionEditData>({
    resolver: zodResolver(factionEditSchema),
    defaultValues: {
      name: faction.name,
      description: faction.description || '',
      ideology: (faction as any).ideology || '',
      leaderId: (faction as any).leaderId || '',
      goals: (faction as any).goals || '',
      structure: (faction as any).structure || '',
      resources: (faction as any).resources || '',
      relationships: (faction as any).relationships || '',
    },
  });

  const onSubmit = (data: FactionEditData) => {
    updateFaction.mutate({ id: faction.id, ...data } as Faction, {
      onSuccess: () => onSubmitSuccess?.(),
    });
  };

  const handleDelete = () => {
    deleteFaction.mutate(faction.id, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">势力名</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="ideology">理念/信仰</Label>
        <Textarea id="ideology" className="resize-none" rows={2} {...form.register('ideology')} />
      </div>

      <div>
        <Label htmlFor="description">描述</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="goals">目标与追求</Label>
        <Textarea id="goals" className="resize-none" rows={2} {...form.register('goals')} />
      </div>

      <div>
        <Label htmlFor="structure">组织结构</Label>
        <Textarea id="structure" className="resize-none" rows={2} {...form.register('structure')} />
      </div>

      <div>
        <Label htmlFor="resources">资源与实力</Label>
        <Textarea id="resources" className="resize-none" rows={2} {...form.register('resources')} />
      </div>

      <div>
        <Label htmlFor="relationships">对外关系</Label>
        <Textarea id="relationships" className="resize-none" rows={2} {...form.register('relationships')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateFaction.isPending}>
          {updateFaction.isPending ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteFaction.isPending}>
          删除
        </Button>
      </div>
    </form>
  );
};
