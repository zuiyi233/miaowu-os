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
import { useDeleteSettingMutation } from '@/core/novel/queries';

interface SettingDeleteDialogProps {
  novelId: string;
  settingId: string;
  settingName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const SettingDeleteDialog: React.FC<SettingDeleteDialogProps> = ({
  novelId,
  settingId,
  settingName: _settingName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const { t } = useI18n();
  const deleteSetting = useDeleteSettingMutation();

  const handleDelete = () => {
    deleteSetting.mutate({ novelId, settingId }, {
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
            {t.novel.deleteSetting}
          </DialogTitle>
          <DialogDescription>
            {t.novel.confirmDeleteSetting}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.novel.cancel}</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteSetting.isPending}>
            {deleteSetting.isPending ? t.novel.deleting : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
