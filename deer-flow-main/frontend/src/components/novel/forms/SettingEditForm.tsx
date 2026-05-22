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
import { useUpdateSettingMutation, useDeleteSettingMutation } from '@/core/novel/queries';
import type { Setting } from '@/core/novel/schemas';

const SETTING_TYPE_VALUES = ['城市', '建筑', '自然景观', '地区', '其他'] as const;

const settingEditSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(SETTING_TYPE_VALUES).default('其他'),
  atmosphere: z.string().optional(),
  history: z.string().optional(),
  keyFeatures: z.string().optional(),
});

type SettingEditInput = z.input<typeof settingEditSchema>;
type SettingEditOutput = z.output<typeof settingEditSchema>;

interface SettingEditFormProps {
  novelId: string;
  setting: Setting;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

const SETTING_TYPE_LABEL_KEYS: Record<string, string> = {
  '城市': 'settingTypeCity',
  '建筑': 'settingTypeBuilding',
  '自然景观': 'settingTypeNaturalLandscape',
  '地区': 'settingTypeRegion',
  '其他': 'settingTypeOther',
};

export const SettingEditForm: React.FC<SettingEditFormProps> = ({
  novelId,
  setting,
  onSubmitSuccess,
  onDelete,
}) => {
  const { t } = useI18n();
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
    deleteSetting.mutate({ novelId, settingId: setting.id }, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">{t.novel.sceneName}</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{t.novel.sceneNameRequired}</p>
        )}
      </div>

      <div>
        <Label htmlFor="type">{t.novel.sceneType}</Label>
        <Select onValueChange={(v) => form.setValue('type', v as any)} defaultValue={setting.type}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SETTING_TYPE_VALUES.map((v) => (
              <SelectItem key={v} value={v}>{(t.novel as any)[SETTING_TYPE_LABEL_KEYS[v]!]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">{t.novel.sceneDescription}</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="atmosphere">{t.novel.fieldAtmosphere}</Label>
        <Textarea id="atmosphere" className="resize-none" rows={2} {...form.register('atmosphere')} />
      </div>

      <div>
        <Label htmlFor="history">{t.novel.itemHistory}</Label>
        <Textarea id="history" className="resize-none" rows={2} {...form.register('history')} />
      </div>

      <div>
        <Label htmlFor="keyFeatures">{t.novel.fieldKeyFeatures}</Label>
        <Textarea id="keyFeatures" className="resize-none" rows={2} {...form.register('keyFeatures')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateSetting.isPending}>
          {updateSetting.isPending ? t.novel.saving : t.common.save}
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteSetting.isPending}>
          {t.common.delete}
        </Button>
      </div>
    </form>
  );
};
