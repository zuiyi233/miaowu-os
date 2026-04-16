'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUpdateCharacterMutation, useDeleteCharacterMutation } from '@/core/novel/queries';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Character } from '@/core/novel/schemas';

const characterEditSchema = z.object({
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

type CharacterEditData = z.infer<typeof characterEditSchema>;

interface CharacterEditFormProps {
  character: Character;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const CharacterEditForm: React.FC<CharacterEditFormProps> = ({
  character,
  onSubmitSuccess,
  onDelete,
}) => {
  const updateCharacter = useUpdateCharacterMutation();
  const deleteCharacter = useDeleteCharacterMutation();
  const form = useForm<CharacterEditData>({
    resolver: zodResolver(characterEditSchema),
    defaultValues: {
      name: character.name,
      description: character.description || '',
      avatar: character.avatar || '',
      age: character.age || '',
      gender: character.gender || '',
      appearance: character.appearance || '',
      personality: character.personality || '',
      motivation: character.motivation || '',
      backstory: character.backstory || '',
      factionId: character.factionId || '',
    },
  });

  const onSubmit = (data: CharacterEditData) => {
    updateCharacter.mutate(
      { id: character.id, ...data } as Character,
      { onSuccess: () => onSubmitSuccess?.() }
    );
  };

  const handleDelete = () => {
    deleteCharacter.mutate(character.id, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">角色名</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="age">年龄</Label>
          <Input id="age" {...form.register('age')} />
        </div>
        <div>
          <Label htmlFor="gender">性别</Label>
          <Input id="gender" {...form.register('gender')} />
        </div>
      </div>

      <div>
        <Label htmlFor="description">简介</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="appearance">外貌描述</Label>
        <Textarea id="appearance" className="resize-none" rows={2} {...form.register('appearance')} />
      </div>

      <div>
        <Label htmlFor="personality">性格特点</Label>
        <Textarea id="personality" className="resize-none" rows={2} {...form.register('personality')} />
      </div>

      <div>
        <Label htmlFor="motivation">动机与目标</Label>
        <Textarea id="motivation" className="resize-none" rows={2} {...form.register('motivation')} />
      </div>

      <div>
        <Label htmlFor="backstory">背景故事</Label>
        <Textarea id="backstory" className="resize-none" rows={3} {...form.register('backstory')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateCharacter.isPending}>
          {updateCharacter.isPending ? '保存中...' : '保存'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={deleteCharacter.isPending}
        >
          删除
        </Button>
      </div>
    </form>
  );
};
