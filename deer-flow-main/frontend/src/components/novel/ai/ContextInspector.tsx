'use client';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAiPanelStore } from '@/core/novel';

export function ContextInspector() {
  const { contextEntities, removeContextEntity } = useAiPanelStore();

  return (
    <div className="flex h-full flex-col p-4">
      <h3 className="mb-4 text-sm font-medium">Context Entities</h3>
      <ScrollArea className="flex-1">
        {contextEntities.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm">
            No entities selected
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {contextEntities.map((entity) => (
              <Badge key={entity} variant="secondary" className="gap-1 pr-1">
                {entity}
                <button
                  onClick={() => removeContextEntity(entity)}
                  className="ml-1 rounded-full hover:bg-muted-foreground/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
