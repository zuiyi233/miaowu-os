'use client';

import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Character, Setting, Faction, Item } from '@/core/novel/schemas';

interface MultiEntitySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (entity: { type: string; id: string; name: string }) => void;
  characters?: Character[];
  settings?: Setting[];
  factions?: Faction[];
  items?: Item[];
}

export const MultiEntitySelector: React.FC<MultiEntitySelectorProps> = ({
  open,
  onOpenChange,
  onSelect,
  characters = [],
  settings = [],
  factions = [],
  items = [],
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择实体</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="characters">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="characters">角色</TabsTrigger>
            <TabsTrigger value="settings">场景</TabsTrigger>
            <TabsTrigger value="factions">势力</TabsTrigger>
            <TabsTrigger value="items">物品</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[300px] mt-4">
            <TabsContent value="characters" className="space-y-2">
              {characters.map((char) => (
                <div
                  key={char.id}
                  className="p-3 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => {
                    onSelect?.({ type: 'character', id: char.id, name: char.name });
                    onOpenChange(false);
                  }}
                >
                  <p className="font-medium">{char.name}</p>
                  {char.description && (
                    <p className="text-xs text-muted-foreground truncate">{char.description}</p>
                  )}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="settings" className="space-y-2">
              {settings.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => {
                    onSelect?.({ type: 'setting', id: s.id, name: s.name });
                    onOpenChange(false);
                  }}
                >
                  <p className="font-medium">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                  )}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="factions" className="space-y-2">
              {factions.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => {
                    onSelect?.({ type: 'faction', id: f.id, name: f.name });
                    onOpenChange(false);
                  }}
                >
                  <p className="font-medium">{f.name}</p>
                  {f.description && (
                    <p className="text-xs text-muted-foreground truncate">{f.description}</p>
                  )}
                </div>
              ))}
            </TabsContent>

            <TabsContent value="items" className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => {
                    onSelect?.({ type: 'item', id: item.id, name: item.name });
                    onOpenChange(false);
                  }}
                >
                  <p className="font-medium">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  )}
                </div>
              ))}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
