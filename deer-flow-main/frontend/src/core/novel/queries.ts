'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { databaseService } from './database';
import { novelApiService } from './novel-api';
import type { AiModelRoutingPayload, QueryValue } from './novel-api';
import { novelDomainService } from './novel-domain-service';
import { emitNovelEvent } from './observability';
import type { Novel, Chapter, Character, Setting, Faction, Item, PromptTemplate, EntityRelationship, TimelineEvent, GraphLayout, Volume } from './schemas';

function stableSerialize(value: unknown): string {
  const sortRecursively = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(sortRecursively);
    }
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortRecursively(record[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortRecursively(value));
}

export interface NovelQualityIssue {
  type: string;
  severity: 'warning' | 'error' | 'info' | 'success';
  message: string;
  details?: Record<string, unknown>;
  relatedIds?: string[];
}

export interface NovelQualityReport {
  novelId: string;
  score: number;
  metrics: {
    wordCount: number;
    chapterCount: number;
    characterCount: number;
    timelineEventCount: number;
  };
  issues: NovelQualityIssue[];
  generatedAt: string;
}

export const NOVEL_QUERY_STALE_TIME_MS = 30_000;
export const QUALITY_REPORT_DEFAULT_REFETCH_INTERVAL_MS = 15000;
export const QUALITY_REPORT_PAGE_REFETCH_INTERVAL_MS = 5000;

function normalizeQualityReport(
  novelId: string,
  remote: Partial<NovelQualityReport>,
): NovelQualityReport {
  return {
    novelId,
    score: typeof remote.score === 'number' ? remote.score : 0,
    metrics: {
      wordCount: remote.metrics?.wordCount ?? 0,
      chapterCount: remote.metrics?.chapterCount ?? 0,
      characterCount: remote.metrics?.characterCount ?? 0,
      timelineEventCount: remote.metrics?.timelineEventCount ?? 0,
    },
    issues: Array.isArray(remote.issues) ? remote.issues : [],
    generatedAt:
      typeof remote.generatedAt === 'string'
        ? remote.generatedAt
        : new Date().toISOString(),
  };
}

async function fetchQualityReport(novelId: string): Promise<NovelQualityReport> {
  const remote = (await novelApiService.getQualityReport(
    novelId,
  )) as Partial<NovelQualityReport>;
  return normalizeQualityReport(novelId, remote);
}

function getQualityReportQueryKey(novelId: string) {
  return ['quality-report', novelId] as const;
}

interface UseQualityReportQueryOptions {
  enabled?: boolean;
  retry?: boolean;
  refetchInterval?: number | false;
}

export function useQualityReportQuery(
  novelId: string,
  options: UseQualityReportQueryOptions = {},
) {
  const {
    enabled = Boolean(novelId),
    retry = false,
    refetchInterval = false,
  } = options;

  return useQuery({
    queryKey: getQualityReportQueryKey(novelId),
    queryFn: () => fetchQualityReport(novelId),
    enabled,
    retry,
    refetchInterval,
  });
}

export function useNovelQuery(novelTitle?: string) {
  return useQuery({
    queryKey: ['novel', novelTitle],
    queryFn: async () => {
      const novel = await novelDomainService.loadNovel(novelTitle!);
      if (novel) {
        emitNovelEvent('novel_open', {
          novelId: novel.id,
          novelTitle: novel.title,
        });
      }
      return novel;
    },
    enabled: !!novelTitle,
    staleTime: NOVEL_QUERY_STALE_TIME_MS,
  });
}

export function useAllNovelsQuery() {
  return useQuery({
    queryKey: ['novels'],
    queryFn: () => novelDomainService.getAllNovels(),
  });
}

export function useDashboardStatsQuery() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => novelDomainService.getDashboardStats(),
  });
}

export function useUpdateNovelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, updates }: { novelId: string | number; updates: Partial<Novel> }) =>
      novelDomainService.updateNovel(novelId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', String(variables.novelId)] });
    },
  });
}

export function useDeleteNovelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (novelId: string | number) =>
      novelDomainService.deleteNovel(String(novelId)).then(() => undefined),
    onSuccess: (_, novelId) => {
      queryClient.removeQueries({ queryKey: ['novel', String(novelId)], exact: true });
      queryClient.invalidateQueries({ queryKey: ['novels'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useUpdateChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chapterId, content, novelId }: { chapterId: string; content: string; novelId?: string }) => {
      if (!novelId) throw new Error('novelId is required to update chapter content');
      return novelDomainService.updateChapterContent(novelId, chapterId, content);
    },
    onSuccess: (_, variables) => {
      emitNovelEvent('chapter_save', {
        chapterId: variables.chapterId,
      });
      if (variables.novelId) {
        queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
      }
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
      novelDomainService.createCharacter(novelId, {
        name: character.name,
        description: character.description,
        factionId: character.factionId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateCharacterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (character: Character) =>
      novelDomainService.updateCharacter(character),
    onSuccess: (_, character) => {
      queryClient.invalidateQueries({ queryKey: ['novel', character.novelId] });
    },
  });
}

export function useDeleteCharacterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, characterId }: { novelId: string; characterId: string }) =>
      novelDomainService.deleteCharacter(novelId, characterId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
    },
  });
}

export function useAddFactionMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (faction: Faction) =>
      novelDomainService.createFaction(novelId, {
        name: faction.name,
        description: faction.description,
        leaderId: faction.leaderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateFactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (faction: Faction) =>
      novelDomainService.updateFaction(faction),
    onSuccess: (_, faction) => {
      queryClient.invalidateQueries({ queryKey: ['novel', faction.novelId] });
    },
  });
}

export function useDeleteFactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, factionId }: { novelId: string; factionId: string }) =>
      novelDomainService.deleteFaction(novelId, factionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
    },
  });
}

export function useAddSettingMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setting: Setting) =>
      novelDomainService.createSetting(novelId, {
        name: setting.name,
        description: setting.description,
        type: setting.type as any,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setting: Setting) =>
      novelDomainService.updateSetting(setting),
    onSuccess: (_, setting) => {
      queryClient.invalidateQueries({ queryKey: ['novel', setting.novelId] });
    },
  });
}

export function useDeleteSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, settingId }: { novelId: string; settingId: string }) =>
      novelDomainService.deleteSetting(novelId, settingId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
    },
  });
}

export function useAddItemMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) =>
      novelDomainService.createItem(novelId, {
        name: item.name,
        description: item.description,
        type: item.type as any,
        ownerId: item.ownerId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useUpdateItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) =>
      novelDomainService.updateItem(item),
    onSuccess: (_, item) => {
      queryClient.invalidateQueries({ queryKey: ['novel', item.novelId] });
    },
  });
}

export function useDeleteItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, itemId }: { novelId: string; itemId: string }) =>
      novelDomainService.deleteItem(novelId, itemId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
    },
  });
}

export function useAddVolumeMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (volume: Volume) => novelDomainService.createVolume(novelId, { title: volume.title, description: volume.description, order: volume.order }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useDeleteVolumeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, volumeId }: { novelId: string; volumeId: string }) =>
      novelDomainService.deleteVolume(novelId, volumeId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
    },
  });
}

export function useAddChapterMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chapter, volumeId }: { chapter: Chapter; volumeId?: string }) =>
      novelDomainService.createChapter(novelId, {
        title: chapter.title,
        content: chapter.content,
        volumeId,
        order: chapter.order,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    },
  });
}

export function useDeleteChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, chapterId }: { novelId: string; chapterId: string }) =>
      novelDomainService.deleteChapter(novelId, chapterId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['novel', variables.novelId] });
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
    queryFn: () => novelDomainService.getRelationships(novelId),
    enabled: !!novelId,
  });
}

export function useTimelineEventsQuery(novelId: string) {
  return useQuery({
    queryKey: ['timeline-events', novelId],
    queryFn: () => novelDomainService.getTimelineEvents(novelId),
    enabled: !!novelId,
  });
}

export function useGraphLayoutQuery(novelId: string) {
  return useQuery({
    queryKey: ['graph-layout', novelId],
    queryFn: () => novelDomainService.getGraphLayout(novelId),
    enabled: !!novelId,
  });
}

export function useSaveGraphLayoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: GraphLayout) =>
      novelDomainService.saveGraphLayout(layout),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph-layout'] });
    },
  });
}

export function useAddTimelineEventMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) =>
      novelDomainService.addTimelineEvent(novelId, event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events', novelId] });
    },
  });
}

export function useUpdateTimelineEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (event: TimelineEvent) =>
      novelDomainService.updateTimelineEvent(event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
    },
  });
}

export function useDeleteTimelineEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, eventId }: { novelId: string; eventId: string }) =>
      novelDomainService.deleteTimelineEvent(novelId, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-events'] });
    },
  });
}

export function useAddRelationshipMutation(novelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationship: EntityRelationship) =>
      novelDomainService.addRelationship(novelId, relationship),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships', novelId] });
    },
  });
}

export function useDeleteRelationshipMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, relationshipId }: { novelId: string; relationshipId: string }) =>
      novelDomainService.deleteRelationship(novelId, relationshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
  });
}

export function useUpdateNodePositionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ novelId, positions }: { novelId: string; positions: Record<string, { x: number; y: number }> }) =>
      novelDomainService.updateNodePositions(novelId, positions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph-layout'] });
    },
  });
}

export function useExportDataMutation() {
  return useMutation({
    mutationFn: () => novelDomainService.exportAllData(),
  });
}

export function useImportDataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => novelDomainService.importData(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel'] });
    },
  });
}

export function useUpdateVolumeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (volume: Volume) => novelDomainService.updateVolume(volume),
    onSuccess: (_, volume) => {
      queryClient.invalidateQueries({ queryKey: ['novel', volume.novelId] });
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
    queryKey: ['careers', projectId, modelRouting ? stableSerialize(modelRouting) : undefined],
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
    queryKey: ['foreshadows', projectId, params ? JSON.stringify(params) : undefined],
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
