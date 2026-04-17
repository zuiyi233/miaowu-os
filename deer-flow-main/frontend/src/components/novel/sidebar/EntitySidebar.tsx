'use client';

import { Users, Castle, MapPin, Gem } from 'lucide-react';
import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/core/i18n/hooks';
import { useNovelQuery } from '@/core/novel/queries';
import { useAddCharacterMutation, useUpdateCharacterMutation, useDeleteCharacterMutation, useAddFactionMutation, useUpdateFactionMutation, useDeleteFactionMutation, useAddSettingMutation, useUpdateSettingMutation, useDeleteSettingMutation, useAddItemMutation, useUpdateItemMutation, useDeleteItemMutation } from '@/core/novel/queries';
import type { Character, Faction, Setting, Item } from '@/core/novel/schemas';

import { EntityManager } from './EntityManager';

interface EntitySidebarProps {
  novelId?: string;
  novelTitle?: string;
  compact?: boolean;
}

export function EntitySidebar({ novelId, novelTitle, compact = false }: EntitySidebarProps) {
  const { t } = useI18n();
  const activeNovelId = novelId || novelTitle || '';
  const { data: novel } = useNovelQuery(activeNovelId);
  const [activeTab, setActiveTab] = useState('characters');

  const addCharacter = useAddCharacterMutation(activeNovelId);
  const updateCharacter = useUpdateCharacterMutation();
  const deleteCharacter = useDeleteCharacterMutation();

  const addFaction = useAddFactionMutation(activeNovelId);
  const updateFaction = useUpdateFactionMutation();
  const deleteFaction = useDeleteFactionMutation();

  const addSetting = useAddSettingMutation(activeNovelId);
  const updateSetting = useUpdateSettingMutation();
  const deleteSetting = useDeleteSettingMutation();

  const addItem = useAddItemMutation(activeNovelId);
  const updateItem = useUpdateItemMutation();
  const deleteItem = useDeleteItemMutation();

  if (!novel || !activeNovelId) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground"><MapPin className="h-8 w-8 opacity-30" /><p className="text-sm">{activeNovelId ? t.novel.loading : t.novel.noNovelSelected}</p></div>;
  }

  const tabs = [
    { id: 'characters', label: t.novel.characters, icon: <Users className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />, entities: novel.characters || [] as Character[] },
    { id: 'factions', label: t.novel.factions, icon: <Castle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />, entities: novel.factions || [] as Faction[] },
    { id: 'settings', label: t.novel.settings_entity, icon: <MapPin className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />, entities: novel.settings || [] as Setting[] },
    { id: 'items', label: t.novel.items, icon: <Gem className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />, entities: novel.items || [] as Item[] },
  ];

  if (compact) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="grid w-full grid-cols-4 h-7 shrink-0">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs gap-1 px-1 h-6">
                {tab.icon}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="characters" className="mt-2 overflow-y-auto flex-1 min-h-0 m-0">
            <EntityManager
              entityType="character"
              entities={novel.characters || []}
              onAdd={(data) => addCharacter.mutate(data as Character)}
              onUpdate={(data) => updateCharacter.mutate(data as Character)}
              onDelete={(id) => deleteCharacter.mutate(id)}
              novelId={activeNovelId}
              compact
            />
          </TabsContent>
          <TabsContent value="factions" className="mt-2 overflow-y-auto flex-1 min-h-0 m-0">
            <EntityManager
              entityType="faction"
              entities={novel.factions || []}
              onAdd={(data) => addFaction.mutate(data as Faction)}
              onUpdate={(data) => updateFaction.mutate(data as Faction)}
              onDelete={(id) => deleteFaction.mutate(id)}
              novelId={activeNovelId}
              compact
            />
          </TabsContent>
          <TabsContent value="settings" className="mt-2 overflow-y-auto flex-1 min-h-0 m-0">
            <EntityManager
              entityType="setting"
              entities={novel.settings || []}
              onAdd={(data) => addSetting.mutate(data as Setting)}
              onUpdate={(data) => updateSetting.mutate(data as Setting)}
              onDelete={(id) => deleteSetting.mutate(id)}
              novelId={activeNovelId}
              compact
            />
          </TabsContent>
          <TabsContent value="items" className="mt-2 overflow-y-auto flex-1 min-h-0 m-0">
            <EntityManager
              entityType="item"
              entities={novel.items || []}
              onAdd={(data) => addItem.mutate(data as Item)}
              onUpdate={(data) => updateItem.mutate(data as Item)}
              onDelete={(id) => deleteItem.mutate(id)}
              novelId={activeNovelId}
              compact
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-muted/30 px-3 py-2">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t.novel.entities}</p>
        <TabsList className="grid w-full grid-cols-4 h-8">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs gap-1 px-1 h-7">
              {tab.icon}
              <span className="hidden xl:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
          <TabsContent value="characters" className="flex-1 overflow-hidden m-0">
            <EntityManager
              entityType="character"
              entities={novel.characters || []}
              onAdd={(data) => addCharacter.mutate(data as Character)}
              onUpdate={(data) => updateCharacter.mutate(data as Character)}
              onDelete={(id) => deleteCharacter.mutate(id)}
              novelId={activeNovelId}
            />
          </TabsContent>
          <TabsContent value="factions" className="flex-1 overflow-hidden m-0">
            <EntityManager
              entityType="faction"
              entities={novel.factions || []}
              onAdd={(data) => addFaction.mutate(data as Faction)}
              onUpdate={(data) => updateFaction.mutate(data as Faction)}
              onDelete={(id) => deleteFaction.mutate(id)}
              novelId={activeNovelId}
            />
          </TabsContent>
          <TabsContent value="settings" className="flex-1 overflow-hidden m-0">
            <EntityManager
              entityType="setting"
              entities={novel.settings || []}
              onAdd={(data) => addSetting.mutate(data as Setting)}
              onUpdate={(data) => updateSetting.mutate(data as Setting)}
              onDelete={(id) => deleteSetting.mutate(id)}
              novelId={activeNovelId}
            />
          </TabsContent>
          <TabsContent value="items" className="flex-1 overflow-hidden m-0">
            <EntityManager
              entityType="item"
              entities={novel.items || []}
              onAdd={(data) => addItem.mutate(data as Item)}
              onUpdate={(data) => updateItem.mutate(data as Item)}
              onDelete={(id) => deleteItem.mutate(id)}
              novelId={activeNovelId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
