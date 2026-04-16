'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Calendar, Clock, Trash2, Edit } from 'lucide-react';
import { useTimelineEventsQuery, useAddTimelineEventMutation, useDeleteTimelineEventMutation } from '@/core/novel/queries';
import type { TimelineEvent } from '@/core/novel/schemas';

interface TimelineViewProps {
  novelTitle: string;
}

export function TimelineView({ novelTitle }: TimelineViewProps) {
  const { data: events } = useTimelineEventsQuery(novelTitle);
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);

  const addMutation = useAddTimelineEventMutation(novelTitle);
  const deleteMutation = useDeleteTimelineEventMutation();

  const handleCreate = async (data: any) => {
    await addMutation.mutateAsync({
      id: crypto.randomUUID(),
      novelTitle,
      ...data,
    });
    setShowCreate(false);
  };

  const handleDelete = async (eventId: string) => {
    if (confirm('Delete this timeline event?')) {
      await deleteMutation.mutateAsync(eventId);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Timeline
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-3 w-3" />
          Add Event
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {!events || events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No timeline events yet. Click &quot;Add Event&quot; to create one.
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
              <div className="space-y-4 pl-8">
                {events.map((event) => (
                  <TimelineEventCard
                    key={event.id}
                    event={event}
                    onDelete={handleDelete}
                    onEdit={() => setEditingEvent(event)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <TimelineEventDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={handleCreate}
      />
    </div>
  );
}

function TimelineEventCard({
  event,
  onDelete,
  onEdit,
}: {
  event: TimelineEvent;
  onDelete: (id: string) => void;
  onEdit: () => void;
}) {
  const typeColors: Record<string, string> = {
    backstory: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    plot: 'bg-green-500/10 text-green-500 border-green-500/20',
    historical: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  };

  return (
    <Card className="relative">
      <div className="absolute -left-8 top-4 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{event.title}</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {event.dateDisplay}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={typeColors[event.type] || ''}
            >
              {event.type}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onEdit}
            >
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(event.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {event.description && (
        <CardContent className="pt-0 text-sm text-muted-foreground">
          {event.description}
        </CardContent>
      )}
    </Card>
  );
}

function TimelineEventDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateDisplay, setDateDisplay] = useState('');
  const [sortValue, setSortValue] = useState(0);
  const [type, setType] = useState<'backstory' | 'plot' | 'historical'>('plot');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title,
      description,
      dateDisplay,
      sortValue,
      type,
    });
    setTitle('');
    setDescription('');
    setDateDisplay('');
    setSortValue(0);
    setType('plot');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Timeline Event</DialogTitle>
            <DialogDescription>
              Create a new event in your story timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Event Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateDisplay">Time Display</Label>
              <Input
                id="dateDisplay"
                placeholder="e.g., Empire Year 305"
                value={dateDisplay}
                onChange={(e) => setDateDisplay(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortValue">Sort Value (Year * 100)</Label>
              <Input
                id="sortValue"
                type="number"
                value={sortValue}
                onChange={(e) => setSortValue(Number(e.target.value))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plot">Plot</SelectItem>
                  <SelectItem value="backstory">Backstory</SelectItem>
                  <SelectItem value="historical">Historical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
