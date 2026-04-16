'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import type { Character, Faction, Setting, Item } from '@/core/novel/schemas';
import { EntityDialog } from '../common/EntityDialog';
import { useI18n } from '@/core/i18n/hooks';

type EntityType = 'character' | 'faction' | 'setting' | 'item';

interface EntityManagerProps {
  entityType: EntityType;
  entities: (Character | Faction | Setting | Item)[];
  onAdd: (data: any) => void;
  onUpdate: (data: any) => void;
  onDelete: (id: string) => void;
  novelId: string;
  compact?: boolean;
}

export function EntityManager({ entityType, entities, onAdd, onUpdate, onDelete, novelId, compact = false }: EntityManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Character | Faction | Setting | Item | null>(null);
  const { t } = useI18n();

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

  const config: Record<EntityType, { icon: React.ReactNode; singularLabel: string; pluralLabel: string }> = {
    character: { icon: <User className="h-4 w-4" />, singularLabel: t.novel.characterSingular, pluralLabel: t.novel.characters },
    faction: { icon: <Shield className="h-4 w-4" />, singularLabel: t.novel.factionSingular, pluralLabel: t.novel.factions },
    setting: { icon: <MapPin className="h-4 w-4" />, singularLabel: t.novel.settingSingular, pluralLabel: t.novel.settings_entity },
    item: { icon: <Gem className="h-4 w-4" />, singularLabel: t.novel.itemSingular, pluralLabel: t.novel.items },
  };

  const handleDelete = async (id: string) => {
    if (confirm(t.novel.deleteConfirm(config[entityType].singularLabel))) {
      onDelete(id);
    }
  };

  const { icon, pluralLabel } = config[entityType];

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-3 flex items-center justify-between">
        <h3 className={`font-medium flex items-center gap-2 ${compact ? 'text-xs' : ''}`}>
          {icon}
          {pluralLabel}
          <Badge variant="secondary" className="text-xs">{entities.length}</Badge>
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-7" onClick={handleAdd}>
          <Plus className="h-3 w-3" />
          {t.novel.add}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {entities.length === 0 ? (
            <div className={`text-center ${compact ? 'py-4 text-xs' : 'py-8 text-sm'} text-muted-foreground`}>
              {t.novel.noEntities(pluralLabel)}
            </div>
          ) : (
            entities.map((entity) => (
              <Card key={entity.id} className={`cursor-pointer hover:bg-accent/50 transition-colors ${compact ? '' : ''}`}>
                <CardHeader className={`pb-0 ${compact ? 'p-2' : 'p-3'}`}>
                  <div className="flex items-start justify-between">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <CardTitle className={`${compact ? 'text-xs' : 'text-sm'} truncate`}>{entity.name}</CardTitle>
                      {'type' in entity && entity.type && (
                        <Badge variant="outline" className="text-xs">{(entity as any).type}</Badge>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`p-0 ${compact ? 'h-5 w-5' : 'h-6 w-6'}`}
                        onClick={() => handleEdit(entity)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`p-0 text-destructive hover:text-destructive ${compact ? 'h-5 w-5' : 'h-6 w-6'}`}
                        onClick={() => handleDelete(entity.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {entity.description && (
                  <CardContent className={`${compact ? 'p-2 pt-0' : 'p-3 pt-1'} text-xs text-muted-foreground line-clamp-2`}>
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
