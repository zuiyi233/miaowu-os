'use client';

import { AlertTriangle } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/core/i18n/hooks';
import { useDeleteCharacterMutation } from '@/core/novel/queries';

interface CharacterDeleteDialogProps {
  novelId: string;
  characterId: string;
  characterName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const CharacterDeleteDialog: React.FC<CharacterDeleteDialogProps> = ({
  novelId,
  characterId,
  characterName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const { t } = useI18n();
  const deleteCharacter = useDeleteCharacterMutation();

  const handleDelete = () => {
    deleteCharacter.mutate({ novelId, characterId }, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            {t.novel.deleteCharacter}
          </DialogTitle>
          <DialogDescription>
            {t.novel.confirmDeleteCharacter}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.novel.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteCharacter.isPending}
          >
            {deleteCharacter.isPending ? t.novel.deleting : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
