'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EntityManager } from './EntityManager';
import { useNovelQuery } from '@/core/novel/queries';
import { useAddCharacterMutation, useUpdateCharacterMutation, useDeleteCharacterMutation, useAddFactionMutation, useUpdateFactionMutation, useDeleteFactionMutation, useAddSettingMutation, useUpdateSettingMutation, useDeleteSettingMutation, useAddItemMutation, useUpdateItemMutation, useDeleteItemMutation } from '@/core/novel/queries';
import { User, MapPin, Shield, Gem } from 'lucide-react';
import type { Character, Faction, Setting, Item } from '@/core/novel/schemas';

interface EntitySidebarProps {
  novelTitle?: string;
}

export function EntitySidebar({ novelTitle = '' }: EntitySidebarProps) {
  const { data: novel } = useNovelQuery(novelTitle);
  const [activeTab, setActiveTab] = useState('characters');

  const addCharacter = useAddCharacterMutation(novelTitle);
  const updateCharacter = useUpdateCharacterMutation();
  const deleteCharacter = useDeleteCharacterMutation();

  const addFaction = useAddFactionMutation(novelTitle);
  const updateFaction = useUpdateFactionMutation();
  const deleteFaction = useDeleteFactionMutation();

  const addSetting = useAddSettingMutation(novelTitle);
  const updateSetting = useUpdateSettingMutation();
  const deleteSetting = useDeleteSettingMutation();

  const addItem = useAddItemMutation(novelTitle);
  const updateItem = useUpdateItemMutation();
  const deleteItem = useDeleteItemMutation();

  if (!novel || !novelTitle) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">{novelTitle ? 'Loading...' : 'Select a novel'}</div>;
  }

  const tabs = [
    { id: 'characters', label: '角色', icon: <User className="h-4 w-4" />, entities: novel.characters || [] as Character[] },
    { id: 'factions', label: '势力', icon: <Shield className="h-4 w-4" />, entities: novel.factions || [] as Faction[] },
    { id: 'settings', label: '场景', icon: <MapPin className="h-4 w-4" />, entities: novel.settings || [] as Setting[] },
    { id: 'items', label: '物品', icon: <Gem className="h-4 w-4" />, entities: novel.items || [] as Item[] },
  ];

  return (
    <div className="flex h-full flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
        <div className="border-b px-2 py-2">
          <TabsList className="grid w-full grid-cols-4 h-8">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs gap-1 px-1 h-7">
                {tab.icon}
                <span className="hidden xl:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="characters" className="flex-1 overflow-hidden m-0">
          <EntityManager
            entityType="character"
            entities={novel.characters || []}
            onAdd={(data) => addCharacter.mutate(data as Character)}
            onUpdate={(data) => updateCharacter.mutate(data as Character)}
            onDelete={(id) => deleteCharacter.mutate(id)}
            novelId={novelTitle}
          />
        </TabsContent>
        <TabsContent value="factions" className="flex-1 overflow-hidden m-0">
          <EntityManager
            entityType="faction"
            entities={novel.factions || []}
            onAdd={(data) => addFaction.mutate(data as Faction)}
            onUpdate={(data) => updateFaction.mutate(data as Faction)}
            onDelete={(id) => deleteFaction.mutate(id)}
            novelId={novelTitle}
          />
        </TabsContent>
        <TabsContent value="settings" className="flex-1 overflow-hidden m-0">
          <EntityManager
            entityType="setting"
            entities={novel.settings || []}
            onAdd={(data) => addSetting.mutate(data as Setting)}
            onUpdate={(data) => updateSetting.mutate(data as Setting)}
            onDelete={(id) => deleteSetting.mutate(id)}
            novelId={novelTitle}
          />
        </TabsContent>
        <TabsContent value="items" className="flex-1 overflow-hidden m-0">
          <EntityManager
            entityType="item"
            entities={novel.items || []}
            onAdd={(data) => addItem.mutate(data as Item)}
            onUpdate={(data) => updateItem.mutate(data as Item)}
            onDelete={(id) => deleteItem.mutate(id)}
            novelId={novelTitle}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
