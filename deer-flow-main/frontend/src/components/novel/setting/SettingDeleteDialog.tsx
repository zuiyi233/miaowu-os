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
import { useDeleteSettingMutation } from '@/core/novel/queries';

interface SettingDeleteDialogProps {
  settingId: string;
  settingName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const SettingDeleteDialog: React.FC<SettingDeleteDialogProps> = ({
  settingId,
  settingName,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const deleteSetting = useDeleteSettingMutation();

  const handleDelete = () => {
    deleteSetting.mutate(settingId, {
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
            删除场景
          </DialogTitle>
          <DialogDescription>
            确定要删除场景"{settingName}"吗？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteSetting.isPending}>
            {deleteSetting.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
