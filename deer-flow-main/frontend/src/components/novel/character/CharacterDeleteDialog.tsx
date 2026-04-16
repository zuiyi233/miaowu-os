'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteCharacterMutation } from '@/core/novel/queries';
import { AlertTriangle } from 'lucide-react';

interface CharacterDeleteDialogProps {
  characterId: string;
  characterName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const CharacterDeleteDialog: React.FC<CharacterDeleteDialogProps> = ({
  characterId,
  characterName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const deleteCharacter = useDeleteCharacterMutation();

  const handleDelete = () => {
    deleteCharacter.mutate(characterId, {
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
            删除角色
          </DialogTitle>
          <DialogDescription>
            确定要删除角色"{characterName}"吗？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteCharacter.isPending}
          >
            {deleteCharacter.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
