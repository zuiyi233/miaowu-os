'use client';

import {
  BookOpen,
  CheckSquare,
  FileText,
  Layers,
  PenTool,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/core/i18n/hooks';
import { useAllNovelsQuery, useDeleteNovelMutation } from '@/core/novel/queries';
import { cn } from '@/lib/utils';

import { NovelCreationDialog } from './NovelCreationDialog';

type NovelId = string;

export function NovelHome() {
  const { t } = useI18n();
  const { data: novels, isLoading } = useAllNovelsQuery();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<NovelId>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<NovelId | null>(null);
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const deleteNovel = useDeleteNovelMutation();

  const toggleSelect = useCallback((id: NovelId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!novels) return;
    setSelectedIds(new Set(novels.map((n) => String(n.id))));
  }, [novels]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const exitManageMode = useCallback(() => {
    setManageMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleDeleteSingle = useCallback(
    (novelId: NovelId) => {
      deleteNovel.mutate(String(novelId), {
        onSuccess: () => {
          toast.success(t.novel.deleted);
          setDeleteTarget(null);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t.novel.deleteFailed);
        },
      });
    },
    [deleteNovel, t]
  );

  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;
    setBatchDeleting(true);
    Promise.all(
      ids.map((id) =>
        deleteNovel
          .mutateAsync(String(id))
          .then(() => {
            successCount++;
          })
          .catch(() => {
            failCount++;
          })
      )
    ).then(() => {
      if (failCount === 0) {
        toast.success(`${t.novel.batchDeleted} ${successCount}`);
      } else {
        toast.error(`${t.novel.batchDeleteResult}：${successCount} ✓，${failCount} ✗`);
      }
      setSelectedIds(new Set());
      setShowBatchDeleteDialog(false);
      setBatchDeleting(false);
      if (failCount === 0 && ids.length >= (novels?.length ?? Infinity)) {
        setManageMode(false);
      }
    });
  }, [deleteNovel, selectedIds, novels, t]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t.novel.loading}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t.novel.title}</h1>
            <p className="text-muted-foreground mt-1">{t.novel.description}</p>
          </div>
          <div className="flex items-center gap-2">
            {manageMode ? (
              <>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-1" />
                  {t.novel.selectAll}
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  <Square className="h-4 w-4 mr-1" />
                  {t.novel.deselectAll}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowBatchDeleteDialog(true)}
                  disabled={selectedIds.size === 0}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t.novel.deleteSelected} ({selectedIds.size})
                </Button>
                <Button variant="ghost" size="sm" onClick={exitManageMode}>
                  <X className="h-4 w-4 mr-1" />
                  {t.novel.exitManage}
                </Button>
              </>
            ) : (
              <>
                {novels && novels.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setManageMode(true)}
                  >
                    <CheckSquare className="h-4 w-4 mr-1" />
                    {t.novel.batchManage}
                  </Button>
                )}
                <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t.novel.newNovel}
                </Button>
              </>
            )}
          </div>
        </div>

        {!novels || novels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="mb-4 h-16 w-16 text-muted-foreground/50" />
            <h2 className="mb-2 text-xl font-semibold">{t.novel.noNovelsYet}</h2>
            <p className="mb-6 max-w-sm text-muted-foreground">
              {t.novel.noNovelsDescription}
            </p>
            <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t.novel.createFirstNovel}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novels.map((novel) => {
              const isSelected = selectedIds.has(String(novel.id));

              return (
                <div key={novel.id} className="relative group">
                  {manageMode && (
                    <div className="absolute top-3 left-3 z-10">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(String(novel.id))}
                        className="h-5 w-5 bg-background border-2"
                      />
                    </div>
                  )}

                  <Link
                    href={
                      manageMode
                        ? '#'
                        : `/workspace/novel/${encodeURIComponent(novel.id)}`
                    }
                    onClick={(e) => {
                      if (manageMode) {
                        e.preventDefault();
                        toggleSelect(String(novel.id));
                      }
                    }}
                  >
                    <Card
                      className={cn(
                        'h-full transition-all',
                        manageMode
                          ? cn(
                              'cursor-pointer',
                              isSelected
                                ? 'ring-2 ring-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            )
                          : 'cursor-pointer hover:shadow-md'
                      )}
                    >
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <BookOpen className="h-5 w-5 shrink-0" />
                          <span className="truncate">{novel.title}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {novel.outline && (
                          <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                            {novel.outline}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {novel.volumesCount} {t.novel.volumes}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {novel.chaptersCount} {t.novel.chapters}
                          </span>
                          <span className="flex items-center gap-1">
                            <PenTool className="h-3 w-3" />
                            {novel.wordCount.toLocaleString()} {t.novel.words}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>

                  {!manageMode && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 z-10 h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget(String(novel.id));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NovelCreationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.novel.confirmDeleteTitle}</DialogTitle>
            <DialogDescription>
              {t.novel.confirmDeleteDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.novel.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget !== null) handleDeleteSingle(deleteTarget);
              }}
              disabled={deleteNovel.isPending}
            >
              {deleteNovel.isPending ? t.novel.deleting : t.novel.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showBatchDeleteDialog}
        onOpenChange={setShowBatchDeleteDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.novel.batchDeleteTitle}</DialogTitle>
            <DialogDescription>
              {t.novel.batchDeleteDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchDeleteDialog(false)}>
              {t.novel.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={deleteNovel.isPending || batchDeleting}
            >
              {(deleteNovel.isPending || batchDeleting) ? t.novel.deleting : `${t.novel.confirmDelete} (${selectedIds.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
