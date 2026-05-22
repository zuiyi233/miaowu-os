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
import { useAddCharacterMutation } from '@/core/novel/queries';

const characterFormSchema = z.object({
  name: z.string().min(1, '角色名不能为空'),
  description: z.string().optional(),
  avatar: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  backstory: z.string().optional(),
  factionId: z.string().optional(),
});

type CharacterFormData = z.infer<typeof characterFormSchema>;

interface CharacterFormProps {
  novelId: string;
  onSubmitSuccess?: () => void;
}

export const CharacterForm: React.FC<CharacterFormProps> = ({
  novelId,
  onSubmitSuccess,
}) => {
  const addCharacter = useAddCharacterMutation(novelId);
  const form = useForm<CharacterFormData>({
    resolver: zodResolver(characterFormSchema),
    defaultValues: {
      name: '',
      description: '',
      avatar: '',
      age: '',
      gender: '',
      appearance: '',
      personality: '',
      motivation: '',
      backstory: '',
      factionId: '',
    },
  });

  const onSubmit = (data: CharacterFormData) => {
    const character = {
      id: crypto.randomUUID(),
      ...data,
      factionId: data.factionId === 'none' ? '' : data.factionId,
      novelId,
    };
    addCharacter.mutate(character as any, {
      onSuccess: () => {
        form.reset();
        onSubmitSuccess?.();
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">角色名</Label>
        <Input
          id="name"
          placeholder="请输入角色名称"
          {...form.register('name')}
        />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="age">年龄</Label>
          <Input id="age" placeholder="年龄" {...form.register('age')} />
        </div>
        <div>
          <Label htmlFor="gender">性别</Label>
          <Input id="gender" placeholder="性别" {...form.register('gender')} />
        </div>
      </div>

      <div>
        <Label htmlFor="factionId">所属势力</Label>
        <Select
          onValueChange={(v) => form.setValue('factionId', v === 'none' ? '' : v)}
          defaultValue=""
        >
          <SelectTrigger>
            <SelectValue placeholder="选择势力" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">无</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">简介</Label>
        <Textarea
          id="description"
          placeholder="角色简介"
          className="resize-none"
          rows={2}
          {...form.register('description')}
        />
      </div>

      <div>
        <Label htmlFor="appearance">外貌描述</Label>
        <Textarea
          id="appearance"
          placeholder="外貌描述"
          className="resize-none"
          rows={2}
          {...form.register('appearance')}
        />
      </div>

      <div>
        <Label htmlFor="personality">性格特点</Label>
        <Textarea
          id="personality"
          placeholder="性格特点"
          className="resize-none"
          rows={2}
          {...form.register('personality')}
        />
      </div>

      <div>
        <Label htmlFor="motivation">动机与目标</Label>
        <Textarea
          id="motivation"
          placeholder="动机与目标"
          className="resize-none"
          rows={2}
          {...form.register('motivation')}
        />
      </div>

      <div>
        <Label htmlFor="backstory">背景故事</Label>
        <Textarea
          id="backstory"
          placeholder="背景故事"
          className="resize-none"
          rows={3}
          {...form.register('backstory')}
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={addCharacter.isPending}
      >
        {addCharacter.isPending ? '保存中...' : '保存角色'}
      </Button>
    </form>
  );
};
