'use client';

import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Character } from '@/core/novel/schemas';

import { CharacterEditForm } from '../forms/CharacterEditForm';

interface CharacterEditDialogProps {
  novelId: string;
  character: Character;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdited?: () => void;
}

export const CharacterEditDialog: React.FC<CharacterEditDialogProps> = ({
  novelId,
  character,
  open,
  onOpenChange,
  onEdited,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑角色：{character.name}</DialogTitle>
        </DialogHeader>
        <CharacterEditForm
          novelId={novelId}
          character={character}
          onSubmitSuccess={() => {
            onEdited?.();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
