'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { databaseService } from './database';
import type { Novel, Chapter, Character, Setting, Faction, Item, PromptTemplate, EntityRelationship, TimelineEvent, GraphLayout, Volume } from './schemas';

export function useNovelQuery(novelTitle?: string) {
  return useQuery({
    queryKey: ['novel', novelTitle],
    queryFn: () => databaseService.loadNovel(novelTitle!),
    enabled: !!novelTitle,
  });
}

export function useAllNovelsQuery() {
  return useQuery({
    queryKey: ['novels'],
    queryFn: () => databaseService.getAllNovels(),
  });
}

export function useDashboardStatsQuery() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => databaseService.getDashboardStats(),
  });
}

export function useUpdateNovelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, updates }: { novelId: string | number; updates: Partial<Novel> }) =>
      databaseService.updateNovel(novelId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
      queryClient.invalidateQueries({ queryKey: ['novels'] });
    },
  });
}

export function useUpdateChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chapterId, content }: { chapterId: string; content: string }) =>
      databaseService.updateChapterContent(chapterId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useSaveSnapshotMutation() {
  return useMutation({
    mutationFn: ({ chapterId, content, description }: { chapterId: string; content: string; description?: string }) =>
      databaseService.createSnapshot(chapterId, content, description),
  });
}

export function useChapterSnapshotsQuery(chapterId?: string) {
  return useQuery({
    queryKey: ['chapter-snapshots', chapterId],
    queryFn: () => databaseService.getChapterSnapshots(chapterId!),
    enabled: !!chapterId,
  });
}

export function useAddCharacterMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (character: Character) => databaseService.addCharacter(character, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateCharacterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (character: Character) => databaseService.updateCharacter(character),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useDeleteCharacterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) => databaseService.deleteCharacter(characterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddFactionMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (faction: Faction) => databaseService.addFaction(faction, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateFactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (faction: Faction) => databaseService.updateFaction(faction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useDeleteFactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (factionId: string) => databaseService.deleteFaction(factionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddSettingMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setting: Setting) => databaseService.addSetting(setting, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setting: Setting) => databaseService.updateSetting(setting),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useDeleteSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settingId: string) => databaseService.deleteSetting(settingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddItemMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) => databaseService.addItem(item, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) => databaseService.updateItem(item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useDeleteItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => databaseService.deleteItem(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddVolumeMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (volume: Volume) => databaseService.addVolume(volume, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useDeleteVolumeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (volumeId: string) => databaseService.deleteVolume(volumeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddChapterMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chapter, volumeId }: { chapter: Chapter; volumeId?: string }) =>
      databaseService.addChapter(chapter, novelId, volumeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useDeleteChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chapterId: string) => databaseService.deleteChapter(chapterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function usePromptTemplatesQuery(type?: string) {
  return useQuery({
    queryKey: ['prompt-templates', type],
    queryFn: () =>
      type
        ? databaseService.getPromptTemplatesByType(type)
        : databaseService.getAllPromptTemplates(),
  });
}

export function useActivePromptTemplateQuery(type: string) {
  return useQuery({
    queryKey: ['active-prompt-template', type],
    queryFn: () => databaseService.getActivePromptTemplate(type),
  });
}

export function useRelationshipsQuery(novelId?: string) {
  return useQuery({
    queryKey: ['relationships', novelId],
    queryFn: () => databaseService.getAllRelationships(novelId),
    enabled: !!novelId,
  });
}

export function useTimelineEventsQuery(novelId: string) {
  return useQuery({
    queryKey: ['timeline-events', novelId],
    queryFn: () => databaseService.getTimelineEvents(novelId),
    enabled: !!novelId,
  });
}

export function useGraphLayoutQuery(novelId: string) {
  return useQuery({
    queryKey: ['graph-layout', novelId],
    queryFn: () => databaseService.getGraphLayout(novelId),
    enabled: !!novelId,
  });
}

export function useSaveGraphLayoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: GraphLayout) => databaseService.saveGraphLayout(layout),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph-layout'] });
    },
  });
}

export function useAddTimelineEventMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) => databaseService.addTimelineEvent(event, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events', novelId] });
    },
  });
}

export function useUpdateTimelineEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) => databaseService.updateTimelineEvent(event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
    },
  });
}

export function useDeleteTimelineEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => databaseService.deleteTimelineEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
    },
  });
}

export function useAddRelationshipMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationship: EntityRelationship) => databaseService.addRelationship(relationship, novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships', novelId] });
    },
  });
}

export function useDeleteRelationshipMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationshipId: string) => databaseService.deleteRelationship(relationshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
  });
}

export function useUpdateNodePositionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, positions }: { novelId: string; positions: Record<string, { x: number; y: number }> }) =>
      databaseService.updateNodePositions(novelId, positions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph-layout'] });
    },
  });
}

export function useExportDataMutation() {
  return useMutation({
    mutationFn: () => databaseService.exportAllData(),
  });
}

export function useImportDataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => databaseService.importData(data),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}
