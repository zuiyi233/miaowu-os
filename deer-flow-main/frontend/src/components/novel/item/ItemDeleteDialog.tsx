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
import { useDeleteItemMutation } from '@/core/novel/queries';

interface ItemDeleteDialogProps {
  novelId: string;
  itemId: string;
  itemName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const ItemDeleteDialog: React.FC<ItemDeleteDialogProps> = ({
  novelId,
  itemId,
  itemName: _itemName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const { t } = useI18n();
  const deleteItem = useDeleteItemMutation();

  const handleDelete = () => {
    deleteItem.mutate({ novelId, itemId }, {
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
            {t.novel.deleteItem}
          </DialogTitle>
          <DialogDescription>
            {t.novel.confirmDeleteItem}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.novel.cancel}</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
            {deleteItem.isPending ? t.novel.deleting : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
