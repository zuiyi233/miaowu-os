'use client';

import { useState, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Edit,
  GripVertical,
  BookOpen,
  Layers,
} from 'lucide-react';
import { useNovelQuery, useDeleteVolumeMutation, useDeleteChapterMutation, useAddChapterMutation, useAddVolumeMutation } from '@/core/novel/queries';
import { useNovelStore } from '@/core/novel';
import type { Volume, Chapter } from '@/core/novel/schemas';

interface OutlineViewProps {
  novelTitle: string;
}

export function OutlineView({ novelTitle }: OutlineViewProps) {
  const { data: novel } = useNovelQuery(novelTitle);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [addingChapterTo, setAddingChapterTo] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [addingVolume, setAddingVolume] = useState(false);
  const [newVolumeTitle, setNewVolumeTitle] = useState('');

  const addVolumeMutation = useAddVolumeMutation(novelTitle);
  const addChapterMutation = useAddChapterMutation(novelTitle);
  const deleteVolumeMutation = useDeleteVolumeMutation();
  const deleteChapterMutation = useDeleteChapterMutation();
  const { setActiveChapterId, setViewMode } = useNovelStore();

  const volumes: Volume[] = novel?.volumes || [];
  const flatChapters: Chapter[] = novel?.chapters || [];

  const handleAddVolume = async () => {
    if (!newVolumeTitle.trim()) return;
    await addVolumeMutation.mutateAsync({
      id: crypto.randomUUID(),
      title: newVolumeTitle,
      description: '',
      chapters: [],
      order: volumes.length,
    });
    setNewVolumeTitle('');
    setAddingVolume(false);
  };

  const handleAddChapter = async (volumeId: string) => {
    if (!newChapterTitle.trim()) return;
    const volume = volumes.find((v) => v.id === volumeId);
    const order = volume?.chapters?.length || 0;

    await addChapterMutation.mutateAsync({
      chapter: {
        id: crypto.randomUUID(),
        title: newChapterTitle,
        content: '<p></p>',
        order,
      },
      volumeId,
    });
    setNewChapterTitle('');
    setAddingChapterTo(null);
  };

  const handleDeleteVolume = async (volumeId: string) => {
    if (confirm('Delete this volume and all its chapters?')) {
      await deleteVolumeMutation.mutateAsync(volumeId);
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (confirm('Delete this chapter?')) {
      await deleteChapterMutation.mutateAsync(chapterId);
    }
  };

  const handleChapterClick = useCallback(
    (chapter: Chapter) => {
      setActiveChapterId(chapter.id);
      setViewMode('editor');
    },
    [setActiveChapterId, setViewMode]
  );

  if (!novel) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No novel data available
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Outline
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setAddingVolume(true)}
        >
          <Plus className="h-3 w-3" />
          Add Volume
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {volumes.length === 0 && !addingVolume && (
            <div className="text-center py-8 text-muted-foreground">
              No volumes yet. Click &quot;Add Volume&quot; to start.
            </div>
          )}

          {volumes.map((volume) => (
            <VolumeItem
              key={volume.id}
              volume={volume}
              editingId={editingId}
              editTitle={editTitle}
              setEditingId={setEditingId}
              setEditTitle={setEditTitle}
              addingChapterTo={addingChapterTo}
              setAddingChapterTo={setAddingChapterTo}
              newChapterTitle={newChapterTitle}
              setNewChapterTitle={setNewChapterTitle}
              onAddChapter={handleAddChapter}
              onDeleteVolume={handleDeleteVolume}
              onDeleteChapter={handleDeleteChapter}
              onChapterClick={handleChapterClick}
              flatChapters={flatChapters}
            />
          ))}

          {addingVolume && (
            <div className="flex gap-2 p-2 bg-accent rounded-lg">
              <Input
                placeholder="Volume title..."
                value={newVolumeTitle}
                onChange={(e) => setNewVolumeTitle(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddVolume()}
              />
              <Button size="sm" onClick={handleAddVolume}>
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddingVolume(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function VolumeItem({
  volume,
  editingId,
  editTitle,
  setEditingId,
  setEditTitle,
  addingChapterTo,
  setAddingChapterTo,
  newChapterTitle,
  setNewChapterTitle,
  onAddChapter,
  onDeleteVolume,
  onDeleteChapter,
  onChapterClick,
  flatChapters,
}: any) {
  const [isExpanded, setIsExpanded] = useState(true);
  const volumeChapters =
    volume.chapters?.length > 0
      ? volume.chapters
      : flatChapters.filter((c: Chapter) => c.volumeId === volume.id);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-3 bg-muted/50">
        <button onClick={() => setIsExpanded(!isExpanded)} className="p-1">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <BookOpen className="h-4 w-4" />
        <span className="font-medium text-sm flex-1">{volume.title}</span>
        <span className="text-xs text-muted-foreground">
          {volumeChapters?.length || 0} chapters
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setAddingChapterTo(volume.id === addingChapterTo ? null : volume.id)}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          onClick={() => onDeleteVolume(volume.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {isExpanded && (
        <div className="pl-8">
          {volumeChapters?.map((chapter: Chapter, index: number) => (
            <div
              key={chapter.id}
              className="flex items-center gap-2 p-2 border-t hover:bg-accent/50 cursor-pointer group"
              onClick={() => onChapterClick(chapter)}
            >
              <span className="text-xs text-muted-foreground w-6 text-right">
                {index + 1}
              </span>
              <span className="text-sm flex-1">{chapter.title}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChapter(chapter.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {addingChapterTo === volume.id && (
            <div className="flex gap-2 p-2 border-t bg-accent/30">
              <Input
                placeholder="Chapter title..."
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                autoFocus
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && onAddChapter(volume.id)}
              />
              <Button
                size="sm"
                className="h-8"
                onClick={() => onAddChapter(volume.id)}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
