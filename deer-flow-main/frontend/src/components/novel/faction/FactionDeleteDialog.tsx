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
import { useDeleteFactionMutation } from '@/core/novel/queries';

interface FactionDeleteDialogProps {
  novelId: string;
  factionId: string;
  factionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const FactionDeleteDialog: React.FC<FactionDeleteDialogProps> = ({
  novelId,
  factionId,
  factionName: _factionName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const { t } = useI18n();
  const deleteFaction = useDeleteFactionMutation();

  const handleDelete = () => {
    deleteFaction.mutate({ novelId, factionId }, {
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
            {t.novel.deleteFaction}
          </DialogTitle>
          <DialogDescription>
            {t.novel.confirmDeleteFaction}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.novel.cancel}</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteFaction.isPending}>
            {deleteFaction.isPending ? t.novel.deleting : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
