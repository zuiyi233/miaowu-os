'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { databaseService } from './database';
import { executeRemoteFirst, novelApiService } from './novel-api';
import type { AiModelRoutingPayload, QueryValue } from './novel-api';
import { emitNovelEvent } from './observability';
import type { Novel, Chapter, Character, Setting, Faction, Item, PromptTemplate, EntityRelationship, TimelineEvent, GraphLayout, Volume } from './schemas';

export function useNovelQuery(novelTitle?: string) {
  return useQuery({
    queryKey: ['novel', novelTitle],
    queryFn: async () => {
      const novel = await executeRemoteFirst(
        () => novelApiService.getNovelByIdOrTitle(novelTitle!),
        () => databaseService.loadNovel(novelTitle!),
        'useNovelQuery',
        async (novel) => {
          if (novel) {
            await databaseService.saveNovel(novel);
          }
        },
      );
      if (novel) {
        emitNovelEvent('novel_open', {
          novelId: novel.id,
          novelTitle: novel.title,
        });
      }
      return novel;
    },
    enabled: !!novelTitle,
  });
}

export function useAllNovelsQuery() {
  return useQuery({
    queryKey: ['novels'],
    queryFn: () =>
      executeRemoteFirst(
        () => novelApiService.getNovels(),
        () => databaseService.getAllNovels(),
        'useAllNovelsQuery',
      ),
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
      executeRemoteFirst(
        () => novelApiService.updateNovel(novelId, updates).then(() => undefined),
        () => databaseService.updateNovel(novelId, updates),
        'useUpdateNovelMutation',
        () => databaseService.updateNovel(novelId, updates),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
      queryClient.invalidateQueries({ queryKey: ['novels'] });
    },
  });
}

export function useDeleteNovelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (novelId: string | number) => {
      const idStr = String(novelId);
      return executeRemoteFirst(
        () => novelApiService.deleteNovel(idStr),
        () => databaseService.deleteNovel(idStr),
        'useDeleteNovelMutation',
        async () => { await databaseService.deleteNovel(idStr); },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
      queryClient.invalidateQueries({ queryKey: ['novels'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useUpdateChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chapterId, content }: { chapterId: string; content: string }) =>
      databaseService.updateChapterContent(chapterId, content),
    onSuccess: (_, variables) => {
      emitNovelEvent('chapter_save', {
        chapterId: variables.chapterId,
      });
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
    mutationFn: (character: Character) =>
      executeRemoteFirst(
        () => novelApiService.createCharacter(novelId, character).then(() => undefined),
        () => databaseService.addCharacter(character, novelId),
        'useAddCharacterMutation',
        () => databaseService.addCharacter(character, novelId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateCharacterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (character: Character) =>
      executeRemoteFirst(
        () => novelApiService.updateCharacter(character).then(() => undefined),
        () => databaseService.updateCharacter(character),
        'useUpdateCharacterMutation',
        () => databaseService.updateCharacter(character),
      ),
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
    mutationFn: (faction: Faction) =>
      executeRemoteFirst(
        () => novelApiService.createFaction(novelId, faction).then(() => undefined),
        () => databaseService.addFaction(faction, novelId),
        'useAddFactionMutation',
        () => databaseService.addFaction(faction, novelId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateFactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (faction: Faction) =>
      executeRemoteFirst(
        () => novelApiService.updateFaction(faction).then(() => undefined),
        () => databaseService.updateFaction(faction),
        'useUpdateFactionMutation',
        () => databaseService.updateFaction(faction),
      ),
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
    mutationFn: (setting: Setting) =>
      executeRemoteFirst(
        () => novelApiService.createSetting(novelId, setting).then(() => undefined),
        () => databaseService.addSetting(setting, novelId),
        'useAddSettingMutation',
        () => databaseService.addSetting(setting, novelId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setting: Setting) =>
      executeRemoteFirst(
        () => novelApiService.updateSetting(setting).then(() => undefined),
        () => databaseService.updateSetting(setting),
        'useUpdateSettingMutation',
        () => databaseService.updateSetting(setting),
      ),
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
    mutationFn: (item: Item) =>
      executeRemoteFirst(
        () => novelApiService.createItem(novelId, item).then(() => undefined),
        () => databaseService.addItem(item, novelId),
        'useAddItemMutation',
        () => databaseService.addItem(item, novelId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) =>
      executeRemoteFirst(
        () => novelApiService.updateItem(item).then(() => undefined),
        () => databaseService.updateItem(item),
        'useUpdateItemMutation',
        () => databaseService.updateItem(item),
      ),
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
      executeRemoteFirst(
        () => novelApiService.createChapter(novelId, { ...chapter, volumeId }).then(() => undefined),
        () => databaseService.addChapter(chapter, novelId, volumeId),
        'useAddChapterMutation',
        () => databaseService.addChapter(chapter, novelId, volumeId),
      ),
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
    queryFn: () =>
      executeRemoteFirst(
        () => novelApiService.getTimelineEvents(novelId),
        () => databaseService.getTimelineEvents(novelId),
        'useTimelineEventsQuery',
        async (events) => {
          await Promise.all(events.map((event) => databaseService.updateTimelineEvent(event)));
        },
      ),
    enabled: !!novelId,
  });
}

export function useGraphLayoutQuery(novelId: string) {
  return useQuery({
    queryKey: ['graph-layout', novelId],
    queryFn: () =>
      executeRemoteFirst(
        () => novelApiService.getGraphLayout(novelId),
        () => databaseService.getGraphLayout(novelId),
        'useGraphLayoutQuery',
        (layout) => {
          if (layout) {
            return databaseService.saveGraphLayout(layout);
          }
        },
      ),
    enabled: !!novelId,
  });
}

export function useSaveGraphLayoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: GraphLayout) =>
      executeRemoteFirst(
        () => novelApiService.saveGraphLayout(layout).then(() => undefined),
        () => databaseService.saveGraphLayout(layout),
        'useSaveGraphLayoutMutation',
        () => databaseService.saveGraphLayout(layout),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph-layout'] });
    },
  });
}

export function useAddTimelineEventMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) =>
      executeRemoteFirst(
        () => novelApiService.addTimelineEvent(novelId, event).then(() => undefined),
        () => databaseService.addTimelineEvent(event, novelId),
        'useAddTimelineEventMutation',
        () => databaseService.addTimelineEvent(event, novelId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events', novelId] });
    },
  });
}

export function useUpdateTimelineEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) =>
      executeRemoteFirst(
        () =>
          novelApiService
            .updateTimelineEvent(event.novelId, event.id, event)
            .then(() => undefined),
        () => databaseService.updateTimelineEvent(event),
        'useUpdateTimelineEventMutation',
        () => databaseService.updateTimelineEvent(event),
      ),
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
      executeRemoteFirst(
        () => novelApiService.updateNodePositions(novelId, positions).then(() => undefined),
        () => databaseService.updateNodePositions(novelId, positions),
        'useUpdateNodePositionsMutation',
        () => databaseService.updateNodePositions(novelId, positions),
      ),
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

export function useUpdateVolumeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (volume: Volume) => databaseService.updateVolume(volume),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useAddPromptTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: PromptTemplate) => databaseService.addPromptTemplate(template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] });
      queryClient.invalidateQueries({ queryKey: ['active-prompt-template'] });
    },
  });
}

export function useUpdatePromptTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: PromptTemplate) => databaseService.updatePromptTemplate(template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] });
      queryClient.invalidateQueries({ queryKey: ['active-prompt-template'] });
    },
  });
}

export function useDeletePromptTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => databaseService.deletePromptTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompt-templates'] });
      queryClient.invalidateQueries({ queryKey: ['active-prompt-template'] });
    },
  });
}

export function useSetActivePromptTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, type }: { templateId: string; type: string }) =>
      databaseService.setActivePromptTemplate(templateId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-prompt-template'] });
    },
  });
}

export function useCareersQuery(projectId: string, modelRouting?: AiModelRoutingPayload) {
  return useQuery({
    queryKey: ['careers', projectId, modelRouting?.module_id, modelRouting?.ai_provider_id, modelRouting?.ai_model],
    queryFn: () => novelApiService.getCareers(projectId, modelRouting),
    enabled: !!projectId,
  });
}

export function useCreateCareerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => novelApiService.createCareer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers'] });
    },
  });
}

export function useUpdateCareerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ careerId, data }: { careerId: string; data: Record<string, unknown> }) =>
      novelApiService.updateCareer(careerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers'] });
    },
  });
}

export function useDeleteCareerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (careerId: string) => novelApiService.deleteCareer(careerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careers'] });
    },
  });
}

export function useForeshadowsQuery(projectId: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['foreshadows', projectId, params],
    queryFn: () => novelApiService.getForeshadows(projectId, params as Record<string, QueryValue>),
    enabled: !!projectId,
  });
}

export function useForeshadowStatsQuery(projectId: string, currentChapter?: number) {
  return useQuery({
    queryKey: ['foreshadow-stats', projectId, currentChapter],
    queryFn: () => novelApiService.getForeshadowStats(projectId, currentChapter),
    enabled: !!projectId,
  });
}

export function useCreateForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => novelApiService.createForeshadow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useUpdateForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foreshadowId, data }: { foreshadowId: string; data: Record<string, unknown> }) =>
      novelApiService.updateForeshadow(foreshadowId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useDeleteForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foreshadowId: string) => novelApiService.deleteForeshadow(foreshadowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function usePlantForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foreshadowId, data }: { foreshadowId: string; data: Record<string, unknown> }) =>
      novelApiService.plantForeshadow(foreshadowId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useResolveForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foreshadowId, data }: { foreshadowId: string; data: Record<string, unknown> }) =>
      novelApiService.resolveForeshadow(foreshadowId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useAbandonForeshadowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foreshadowId, reason }: { foreshadowId: string; reason?: string }) =>
      novelApiService.abandonForeshadow(foreshadowId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useSyncForeshadowsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, autoSetPlanted }: { projectId: string; autoSetPlanted?: boolean }) =>
      novelApiService.syncForeshadowsFromAnalysis(projectId, autoSetPlanted),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadows'] });
      queryClient.invalidateQueries({ queryKey: ['foreshadow-stats'] });
    },
  });
}

export function useBookImportTaskStatusQuery(taskId: string | null) {
  return useQuery({
    queryKey: ['book-import-task', taskId],
    queryFn: () => novelApiService.getBookImportTaskStatus(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && ['completed', 'failed', 'cancelled'].includes(data.status)) {
        return false;
      }
      return 1500;
    },
  });
}
