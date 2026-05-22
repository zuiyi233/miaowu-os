'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/core/i18n/hooks';
import { useUpdateItemMutation, useDeleteItemMutation } from '@/core/novel/queries';
import type { Item } from '@/core/novel/schemas';

const ITEM_TYPE_VALUES = ['关键物品', '武器', '科技装置', '普通物品', '其他'] as const;

const itemEditSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(ITEM_TYPE_VALUES).default('其他'),
  appearance: z.string().optional(),
  history: z.string().optional(),
  abilities: z.string().optional(),
  ownerId: z.string().optional(),
});

type ItemEditInput = z.input<typeof itemEditSchema>;
type ItemEditOutput = z.output<typeof itemEditSchema>;

interface ItemEditFormProps {
  novelId: string;
  item: Item;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

const ITEM_TYPE_LABEL_KEYS: Record<string, string> = {
  '关键物品': 'itemTypeKeyItem',
  '武器': 'itemTypeWeapon',
  '科技装置': 'itemTypeTechDevice',
  '普通物品': 'itemTypeCommonItem',
  '其他': 'itemTypeOther',
};

export const ItemEditForm: React.FC<ItemEditFormProps> = ({ novelId, item, onSubmitSuccess, onDelete }) => {
  const { t } = useI18n();
  const updateItem = useUpdateItemMutation();
  const deleteItem = useDeleteItemMutation();
  const form = useForm<ItemEditInput, unknown, ItemEditOutput>({
    resolver: zodResolver(itemEditSchema),
    defaultValues: {
      name: item.name,
      description: item.description || '',
      type: item.type ?? '其他',
      appearance: item.appearance || '',
      history: item.history || '',
      abilities: item.abilities || '',
      ownerId: (item as any).ownerId || '',
    },
  });

  const onSubmit = (data: ItemEditOutput) => {
    updateItem.mutate({ id: item.id, ...data } as Item, { onSuccess: () => onSubmitSuccess?.() });
  };

  const handleDelete = () => {
    deleteItem.mutate({ novelId, itemId: item.id }, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">{t.novel.itemName}</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{t.novel.itemNameRequired}</p>
        )}
      </div>

      <div>
        <Label htmlFor="type">{t.novel.type}</Label>
        <Select onValueChange={(v) => form.setValue('type', v as any)} defaultValue={item.type}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ITEM_TYPE_VALUES.map((v) => (
              <SelectItem key={v} value={v}>{(t.novel as any)[ITEM_TYPE_LABEL_KEYS[v]!]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">{t.novel.entityDescription}</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="appearance">{t.novel.itemAppearance}</Label>
        <Textarea id="appearance" className="resize-none" rows={2} {...form.register('appearance')} />
      </div>

      <div>
        <Label htmlFor="history">{t.novel.itemHistory}</Label>
        <Textarea id="history" className="resize-none" rows={2} {...form.register('history')} />
      </div>

      <div>
        <Label htmlFor="abilities">{t.novel.itemAbilities}</Label>
        <Textarea id="abilities" className="resize-none" rows={2} {...form.register('abilities')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateItem.isPending}>
          {updateItem.isPending ? t.novel.saving : t.common.save}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
          {t.common.delete}
        </Button>
      </div>
    </form>
  );
};
