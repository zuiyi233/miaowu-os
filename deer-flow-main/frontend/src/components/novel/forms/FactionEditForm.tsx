'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/core/i18n/hooks';
import { useUpdateFactionMutation, useDeleteFactionMutation } from '@/core/novel/queries';
import type { Faction } from '@/core/novel/schemas';

interface FactionEditFormProps {
  novelId: string;
  faction: Faction;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const FactionEditForm: React.FC<FactionEditFormProps> = ({
  novelId,
  faction,
  onSubmitSuccess,
  onDelete,
}) => {
  const { t } = useI18n();
  const updateFaction = useUpdateFactionMutation();
  const deleteFaction = useDeleteFactionMutation();

  const factionEditSchema = z.object({
    name: z.string().min(1, t.novel.factionNameRequired),
    description: z.string().optional(),
    ideology: z.string().optional(),
    leaderId: z.string().optional(),
    goals: z.string().optional(),
    structure: z.string().optional(),
    resources: z.string().optional(),
    relationships: z.string().optional(),
  });

  type FactionEditData = z.infer<typeof factionEditSchema>;

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
    deleteFaction.mutate({ novelId, factionId: faction.id }, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">{t.novel.factionName}</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="ideology">{t.novel.fieldIdeology}</Label>
        <Textarea id="ideology" className="resize-none" rows={2} {...form.register('ideology')} />
      </div>

      <div>
        <Label htmlFor="description">{t.novel.entityDescription}</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="goals">{t.novel.fieldGoals}</Label>
        <Textarea id="goals" className="resize-none" rows={2} {...form.register('goals')} />
      </div>

      <div>
        <Label htmlFor="structure">{t.novel.fieldStructure}</Label>
        <Textarea id="structure" className="resize-none" rows={2} {...form.register('structure')} />
      </div>

      <div>
        <Label htmlFor="resources">{t.novel.fieldResources}</Label>
        <Textarea id="resources" className="resize-none" rows={2} {...form.register('resources')} />
      </div>

      <div>
        <Label htmlFor="relationships">{t.novel.externalRelations}</Label>
        <Textarea id="relationships" className="resize-none" rows={2} {...form.register('relationships')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateFaction.isPending}>
          {updateFaction.isPending ? t.novel.saving : t.common.save}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteFaction.isPending}>
          {t.common.delete}
        </Button>
      </div>
    </form>
  );
};
