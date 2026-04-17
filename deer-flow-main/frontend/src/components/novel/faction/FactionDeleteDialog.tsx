'use client';

import { AlertTriangle } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useDeleteFactionMutation } from '@/core/novel/queries';

interface FactionDeleteDialogProps {
  factionId: string;
  factionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const FactionDeleteDialog: React.FC<FactionDeleteDialogProps> = ({
  factionId,
  factionName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const deleteFaction = useDeleteFactionMutation();

  const handleDelete = () => {
    deleteFaction.mutate(factionId, {
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
            删除势力
          </DialogTitle>
          <DialogDescription>
            确定要删除势力"{factionName}"吗？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteFaction.isPending}>
            {deleteFaction.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
