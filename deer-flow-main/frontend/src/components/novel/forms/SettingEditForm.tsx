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
import { useUpdateSettingMutation, useDeleteSettingMutation } from '@/core/novel/queries';
import type { Setting } from '@/core/novel/schemas';

const settingEditSchema = z.object({
  name: z.string().min(1, '场景名不能为空'),
  description: z.string().optional(),
  type: z.enum(['城市', '建筑', '自然景观', '地区', '其他']).default('其他'),
  atmosphere: z.string().optional(),
  history: z.string().optional(),
  keyFeatures: z.string().optional(),
});

type SettingEditInput = z.input<typeof settingEditSchema>;
type SettingEditOutput = z.output<typeof settingEditSchema>;

interface SettingEditFormProps {
  setting: Setting;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const SettingEditForm: React.FC<SettingEditFormProps> = ({
  setting,
  onSubmitSuccess,
  onDelete,
}) => {
  const updateSetting = useUpdateSettingMutation();
  const deleteSetting = useDeleteSettingMutation();
  const form = useForm<SettingEditInput, unknown, SettingEditOutput>({
    resolver: zodResolver(settingEditSchema),
    defaultValues: {
      name: setting.name,
      description: setting.description || '',
      type: setting.type ?? '其他',
      atmosphere: (setting as any).atmosphere || '',
      history: (setting as any).history || '',
      keyFeatures: (setting as any).keyFeatures || '',
    },
  });

  const onSubmit = (data: SettingEditOutput) => {
    updateSetting.mutate({ id: setting.id, ...data } as Setting, {
      onSuccess: () => onSubmitSuccess?.(),
    });
  };

  const handleDelete = () => {
    deleteSetting.mutate(setting.id, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">场景名</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="type">场景类型</Label>
        <Select onValueChange={(v) => form.setValue('type', v as any)} defaultValue={setting.type}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="城市">城市</SelectItem>
            <SelectItem value="建筑">建筑</SelectItem>
            <SelectItem value="自然景观">自然景观</SelectItem>
            <SelectItem value="地区">地区</SelectItem>
            <SelectItem value="其他">其他</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">场景描述</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="atmosphere">氛围描述</Label>
        <Textarea id="atmosphere" className="resize-none" rows={2} {...form.register('atmosphere')} />
      </div>

      <div>
        <Label htmlFor="history">历史背景</Label>
        <Textarea id="history" className="resize-none" rows={2} {...form.register('history')} />
      </div>

      <div>
        <Label htmlFor="keyFeatures">关键特征或地标</Label>
        <Textarea id="keyFeatures" className="resize-none" rows={2} {...form.register('keyFeatures')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateSetting.isPending}>
          {updateSetting.isPending ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteSetting.isPending}>
          删除
        </Button>
      </div>
    </form>
  );
};
