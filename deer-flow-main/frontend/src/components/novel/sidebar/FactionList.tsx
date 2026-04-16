'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Shield } from 'lucide-react';
import type { Faction } from '@/core/novel/schemas';

interface FactionListProps {
  factions: Faction[];
  onFactionClick?: (faction: Faction) => void;
  onAddFaction?: () => void;
}

export const FactionList: React.FC<FactionListProps> = ({
  factions,
  onFactionClick,
  onAddFaction,
}) => {
  const [search, setSearch] = React.useState('');

  const filtered = factions.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索势力..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {onAddFaction && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAddFaction}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="h-[200px]">
        <div className="space-y-1">
          {filtered.map((faction) => (
            <button
              key={faction.id}
              className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 transition-colors text-left"
              onClick={() => onFactionClick?.(faction)}
            >
              <div className="h-6 w-6 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                <Shield className="h-3 w-3 text-purple-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{faction.name}</p>
                {faction.description && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {faction.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
