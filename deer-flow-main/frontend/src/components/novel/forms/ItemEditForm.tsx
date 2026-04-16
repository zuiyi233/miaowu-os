'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUpdateItemMutation, useDeleteItemMutation } from '@/core/novel/queries';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { Item } from '@/core/novel/schemas';

const itemEditSchema = z.object({
  name: z.string().min(1, '物品名不能为空'),
  description: z.string().optional(),
  type: z.enum(['关键物品', '武器', '科技装置', '普通物品', '其他']).default('其他'),
  appearance: z.string().optional(),
  history: z.string().optional(),
  abilities: z.string().optional(),
  ownerId: z.string().optional(),
});

type ItemEditData = z.infer<typeof itemEditSchema>;

interface ItemEditFormProps {
  item: Item;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const ItemEditForm: React.FC<ItemEditFormProps> = ({ item, onSubmitSuccess, onDelete }) => {
  const updateItem = useUpdateItemMutation();
  const deleteItem = useDeleteItemMutation();
  const form = useForm<ItemEditData>({
    resolver: zodResolver(itemEditSchema),
    defaultValues: {
      name: item.name,
      description: item.description || '',
      type: item.type as any || '其他',
      appearance: item.appearance || '',
      history: item.history || '',
      abilities: item.abilities || '',
      ownerId: (item as any).ownerId || '',
    },
  });

  const onSubmit = (data: ItemEditData) => {
    updateItem.mutate({ id: item.id, ...data } as Item, { onSuccess: () => onSubmitSuccess?.() });
  };

  const handleDelete = () => {
    deleteItem.mutate(item.id, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">物品名</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="type">类型</Label>
        <Select onValueChange={(v) => form.setValue('type', v as any)} defaultValue={item.type}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="关键物品">关键物品</SelectItem>
            <SelectItem value="武器">武器</SelectItem>
            <SelectItem value="科技装置">科技装置</SelectItem>
            <SelectItem value="普通物品">普通物品</SelectItem>
            <SelectItem value="其他">其他</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">描述</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="appearance">外观描述</Label>
        <Textarea id="appearance" className="resize-none" rows={2} {...form.register('appearance')} />
      </div>

      <div>
        <Label htmlFor="history">历史来源</Label>
        <Textarea id="history" className="resize-none" rows={2} {...form.register('history')} />
      </div>

      <div>
        <Label htmlFor="abilities">功能或能力</Label>
        <Textarea id="abilities" className="resize-none" rows={2} {...form.register('abilities')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateItem.isPending}>
          {updateItem.isPending ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
          删除
        </Button>
      </div>
    </form>
  );
};
