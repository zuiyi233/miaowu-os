'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  User,
  MapPin,
  Shield,
  Gem,
  Plus,
  Edit,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import type { Character, Faction, Setting, Item } from '@/core/novel/schemas';
import { EntityDialog } from '../common/EntityDialog';

type EntityType = 'character' | 'faction' | 'setting' | 'item';

interface EntityManagerProps {
  entityType: EntityType;
  entities: (Character | Faction | Setting | Item)[];
  onAdd: (data: any) => void;
  onUpdate: (data: any) => void;
  onDelete: (id: string) => void;
  novelId: string;
}

export function EntityManager({ entityType, entities, onAdd, onUpdate, onDelete, novelId }: EntityManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Character | Faction | Setting | Item | null>(null);

  const handleAdd = () => {
    setEditingEntity(null);
    setDialogOpen(true);
  };

  const handleEdit = (entity: Character | Faction | Setting | Item) => {
    setEditingEntity(entity);
    setDialogOpen(true);
  };

  const handleSubmit = (data: any) => {
    if (editingEntity) {
      onUpdate(data);
    } else {
      onAdd(data);
    }
    setDialogOpen(false);
    setEditingEntity(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm(`Delete this ${entityType}?`)) {
      onDelete(id);
    }
  };

  const config: Record<EntityType, { icon: React.ReactNode; label: string; color: string }> = {
    character: { icon: <User className="h-4 w-4" />, label: 'Character', color: 'bg-blue-500/10 text-blue-500' },
    faction: { icon: <Shield className="h-4 w-4" />, label: 'Faction', color: 'bg-red-500/10 text-red-500' },
    setting: { icon: <MapPin className="h-4 w-4" />, label: 'Setting', color: 'bg-green-500/10 text-green-500' },
    item: { icon: <Gem className="h-4 w-4" />, label: 'Item', color: 'bg-purple-500/10 text-purple-500' },
  };

  const { icon, label, color } = config[entityType];

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-3 flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          {icon}
          {label}s
          <Badge variant="secondary" className="text-xs">{entities.length}</Badge>
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-7" onClick={handleAdd}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {entities.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No {label.toLowerCase()}s yet. Click &quot;Add&quot; to create one.
            </div>
          ) : (
            entities.map((entity) => (
              <Card key={entity.id} className="cursor-pointer hover:bg-accent/50 transition-colors">
                <CardHeader className="p-3 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="space-y-0.5">
                      <CardTitle className="text-sm">{entity.name}</CardTitle>
                      {'type' in entity && entity.type && (
                        <Badge variant="outline" className="text-xs">{(entity as any).type}</Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleEdit(entity)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(entity.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {entity.description && (
                  <CardContent className="p-3 pt-1 text-xs text-muted-foreground line-clamp-2">
                    {entity.description}
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        entityType={entityType}
        initialData={editingEntity}
        novelId={novelId}
      />
    </div>
  );
}
