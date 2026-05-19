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
import { useUpdateCharacterMutation, useDeleteCharacterMutation } from '@/core/novel/queries';
import type { Character } from '@/core/novel/schemas';

interface CharacterEditFormProps {
  novelId: string;
  character: Character;
  onSubmitSuccess?: () => void;
  onDelete?: () => void;
}

export const CharacterEditForm: React.FC<CharacterEditFormProps> = ({
  novelId,
  character,
  onSubmitSuccess,
  onDelete,
}) => {
  const { t } = useI18n();
  const updateCharacter = useUpdateCharacterMutation();
  const deleteCharacter = useDeleteCharacterMutation();

  const characterEditSchema = z.object({
    name: z.string().min(1, t.novel.characterNameRequired),
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

  const form = useForm({
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

  const onSubmit = (data: any) => {
    updateCharacter.mutate(
      { id: character.id, ...data } as Character,
      { onSuccess: () => onSubmitSuccess?.() }
    );
  };

  const handleDelete = () => {
    deleteCharacter.mutate({ novelId, characterId: character.id }, { onSuccess: () => onDelete?.() });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">{t.novel.characterName}</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="age">{t.novel.fieldAge}</Label>
          <Input id="age" {...form.register('age')} />
        </div>
        <div>
          <Label htmlFor="gender">{t.novel.fieldGender}</Label>
          <Input id="gender" {...form.register('gender')} />
        </div>
      </div>

      <div>
        <Label htmlFor="description">{t.novel.entityDescription}</Label>
        <Textarea id="description" className="resize-none" rows={2} {...form.register('description')} />
      </div>

      <div>
        <Label htmlFor="appearance">{t.novel.fieldAppearance}</Label>
        <Textarea id="appearance" className="resize-none" rows={2} {...form.register('appearance')} />
      </div>

      <div>
        <Label htmlFor="personality">{t.novel.fieldPersonality}</Label>
        <Textarea id="personality" className="resize-none" rows={2} {...form.register('personality')} />
      </div>

      <div>
        <Label htmlFor="motivation">{t.novel.motivation}</Label>
        <Textarea id="motivation" className="resize-none" rows={2} {...form.register('motivation')} />
      </div>

      <div>
        <Label htmlFor="backstory">{t.novel.backstory}</Label>
        <Textarea id="backstory" className="resize-none" rows={3} {...form.register('backstory')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={updateCharacter.isPending}>
          {updateCharacter.isPending ? t.novel.saving : t.common.save}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={deleteCharacter.isPending}
        >
          {t.common.delete}
        </Button>
      </div>
    </form>
  );
};
