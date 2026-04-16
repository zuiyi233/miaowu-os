'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Search, Plus } from 'lucide-react';
import type { Character } from '@/core/novel/schemas';

interface VirtualizedCharacterListProps {
  characters: Character[];
  onCharacterClick?: (character: Character) => void;
  onAddCharacter?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const VirtualizedCharacterList: React.FC<VirtualizedCharacterListProps> = ({
  characters,
  onCharacterClick,
  onAddCharacter,
  searchQuery,
  onSearchChange,
}) => {
  const [search, setSearch] = React.useState('');

  const filtered = characters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    onSearchChange?.(value);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索角色..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {onAddCharacter && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAddCharacter}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="h-[200px]">
        <div className="space-y-1">
          {filtered.map((character) => (
            <button
              key={character.id}
              className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 transition-colors text-left"
              onClick={() => onCharacterClick?.(character)}
            >
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarImage src={character.avatar} />
                <AvatarFallback className="text-[10px]">{character.name[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{character.name}</p>
                {character.description && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {character.description}
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
