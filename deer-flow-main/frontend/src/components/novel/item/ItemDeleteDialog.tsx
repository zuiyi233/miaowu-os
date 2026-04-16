'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteItemMutation } from '@/core/novel/queries';
import { AlertTriangle } from 'lucide-react';

interface ItemDeleteDialogProps {
  itemId: string;
  itemName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const ItemDeleteDialog: React.FC<ItemDeleteDialogProps> = ({
  itemId,
  itemName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const deleteItem = useDeleteItemMutation();

  const handleDelete = () => {
    deleteItem.mutate(itemId, {
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
            删除物品
          </DialogTitle>
          <DialogDescription>
            确定要删除物品"{itemName}"吗？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
            {deleteItem.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
