'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAddSettingMutation } from '@/core/novel/queries';
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

const settingFormSchema = z.object({
  name: z.string().min(1, '场景名不能为空'),
  description: z.string().optional(),
  type: z.enum(['城市', '建筑', '自然景观', '地区', '其他']).default('其他'),
  atmosphere: z.string().optional(),
  history: z.string().optional(),
  keyFeatures: z.string().optional(),
});

type SettingFormInput = z.input<typeof settingFormSchema>;
type SettingFormOutput = z.output<typeof settingFormSchema>;

interface SettingFormProps {
  novelId: string;
  onSubmitSuccess?: () => void;
}

export const SettingForm: React.FC<SettingFormProps> = ({ novelId, onSubmitSuccess }) => {
  const addSetting = useAddSettingMutation(novelId);
  const form = useForm<SettingFormInput, unknown, SettingFormOutput>({
    resolver: zodResolver(settingFormSchema),
    defaultValues: {
      name: '',
      description: '',
      type: '其他',
      atmosphere: '',
      history: '',
      keyFeatures: '',
    },
  });

  const onSubmit = (data: SettingFormOutput) => {
    const setting = {
      id: crypto.randomUUID(),
      ...data,
      novelId,
    };
    addSetting.mutate(setting as any, {
      onSuccess: () => {
        form.reset();
        onSubmitSuccess?.();
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">场景名</Label>
        <Input id="name" placeholder="例如：古老的图书馆" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="type">场景类型</Label>
        <Select onValueChange={(v) => form.setValue('type', v as any)} defaultValue="其他">
          <SelectTrigger><SelectValue placeholder="选择场景类型" /></SelectTrigger>
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
        <Textarea id="description" placeholder="场景描述" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="atmosphere">氛围描述</Label>
        <Textarea id="atmosphere" placeholder="氛围描述" className="resize-none" rows={2} {...form.register('atmosphere')} />
      </div>

      <div>
        <Label htmlFor="history">历史背景</Label>
        <Textarea id="history" placeholder="历史背景" className="resize-none" rows={2} {...form.register('history')} />
      </div>

      <div>
        <Label htmlFor="keyFeatures">关键特征或地标</Label>
        <Textarea id="keyFeatures" placeholder="关键特征或地标" className="resize-none" rows={2} {...form.register('keyFeatures')} />
      </div>

      <Button type="submit" className="w-full" disabled={addSetting.isPending}>
        {addSetting.isPending ? '保存中...' : '保存场景'}
      </Button>
    </form>
  );
};
