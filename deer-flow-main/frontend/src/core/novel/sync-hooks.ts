'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { novelApiService } from './novel-api';
import type { Chapter, Character, Novel, Outline } from './schemas';
import { useNovelStore } from './useNovelStore';

function useNovelResourceSync(novelId: string | null | undefined, novel: Novel | null | undefined) {
  const { setChapters, setCharacters } = useNovelStore();

  useEffect(() => {
    if (!novelId || !novel) {
      setChapters([]);
      setCharacters([]);
      return;
    }
    setChapters(novel.chapters ?? []);
    setCharacters(novel.characters ?? []);
  }, [novelId, novel, setChapters, setCharacters]);
}

export function useProjectSync(novelId?: string | null) {
  const setOutlines = useNovelStore((state) => state.setOutlines);

  const projectQuery = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => novelApiService.getNovelByIdOrTitle(novelId!),
    enabled: !!novelId,
  });

  const outlinesQuery = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => novelApiService.getOutlines(novelId!),
    enabled: !!novelId,
  });

  useNovelResourceSync(novelId, projectQuery.data);

  useEffect(() => {
    setOutlines(outlinesQuery.data ?? []);
  }, [outlinesQuery.data, setOutlines]);

  const refreshProject = useCallback(async () => {
    if (!novelId) {
      return null;
    }
    const [projectResult] = await Promise.all([
      projectQuery.refetch(),
      outlinesQuery.refetch(),
    ]);
    return projectResult.data ?? null;
  }, [novelId, outlinesQuery, projectQuery]);

  return {
    project: projectQuery.data ?? null,
    outlines: outlinesQuery.data ?? [],
    isLoading: projectQuery.isLoading || outlinesQuery.isLoading,
    error: projectQuery.error ?? outlinesQuery.error ?? null,
    refreshProject,
  };
}

export function useCharacterSync(novelId: string) {
  const queryClient = useQueryClient();
  const { setCharacters } = useNovelStore();

  const charactersQuery = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => novelApiService.getCharacters(novelId),
    enabled: !!novelId,
  });

  useEffect(() => {
    setCharacters(charactersQuery.data ?? []);
  }, [charactersQuery.data, setCharacters]);

  const refreshCharacters = useCallback(async () => {
    const result = await charactersQuery.refetch();
    return result.data ?? [];
  }, [charactersQuery]);

  const createCharacter = useCallback(async (character: Character) => {
    const created = await novelApiService.createCharacter(novelId, character);
    queryClient.setQueryData<Character[]>(['characters', novelId], (prev = []) => [...prev, created]);
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    return created;
  }, [novelId, queryClient]);

  const updateCharacter = useCallback(async (character: Character) => {
    const updated = await novelApiService.updateCharacter(character);
    queryClient.setQueryData<Character[]>(['characters', novelId], (prev = []) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    return updated;
  }, [novelId, queryClient]);

  const deleteCharacter = useCallback(async (characterId: string) => {
    await novelApiService.deleteCharacter(novelId, characterId);
    queryClient.setQueryData<Character[]>(['characters', novelId], (prev = []) =>
      prev.filter((item) => item.id !== characterId),
    );
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
  }, [novelId, queryClient]);

  return {
    characters: charactersQuery.data ?? [],
    isLoading: charactersQuery.isLoading,
    error: charactersQuery.error ?? null,
    refreshCharacters,
    createCharacter,
    updateCharacter,
    deleteCharacter,
  };
}

export function useOutlineSync(novelId: string) {
  const queryClient = useQueryClient();
  const { setOutlines } = useNovelStore();

  const outlinesQuery = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => novelApiService.getOutlines(novelId),
    enabled: !!novelId,
  });

  useEffect(() => {
    setOutlines(outlinesQuery.data ?? []);
  }, [outlinesQuery.data, setOutlines]);

  const refreshOutlines = useCallback(async () => {
    const result = await outlinesQuery.refetch();
    return result.data ?? [];
  }, [outlinesQuery]);

  const createOutline = useCallback(async (outline: Outline) => {
    const created = await novelApiService.createOutline(novelId, outline);
    queryClient.setQueryData<Outline[]>(['outlines', novelId], (prev = []) => [...prev, created]);
    return created;
  }, [novelId, queryClient]);

  const updateOutline = useCallback(async (outlineId: string, updates: Partial<Outline>) => {
    const updated = await novelApiService.updateOutline(outlineId, updates);
    queryClient.setQueryData<Outline[]>(['outlines', novelId], (prev = []) =>
      prev.map((item) => (item.id === outlineId ? updated : item)),
    );
    return updated;
  }, [novelId, queryClient]);

  const deleteOutline = useCallback(async (outlineId: string) => {
    await novelApiService.deleteOutline(outlineId);
    queryClient.setQueryData<Outline[]>(['outlines', novelId], (prev = []) =>
      prev.filter((item) => item.id !== outlineId),
    );
  }, [novelId, queryClient]);

  return {
    outlines: outlinesQuery.data ?? [],
    isLoading: outlinesQuery.isLoading,
    error: outlinesQuery.error ?? null,
    refreshOutlines,
    createOutline,
    updateOutline,
    deleteOutline,
  };
}

export function useChapterSync(novelId: string) {
  const queryClient = useQueryClient();
  const { setChapters } = useNovelStore();

  const chaptersQuery = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => novelApiService.getChapters(novelId),
    enabled: !!novelId,
  });

  useEffect(() => {
    setChapters(chaptersQuery.data ?? []);
  }, [chaptersQuery.data, setChapters]);

  const refreshChapters = useCallback(async () => {
    const result = await chaptersQuery.refetch();
    return result.data ?? [];
  }, [chaptersQuery]);

  const createChapter = useCallback(async (chapter: Chapter) => {
    const created = await novelApiService.createChapter(novelId, chapter);
    queryClient.setQueryData<Chapter[]>(['chapters', novelId], (prev = []) => [...prev, created]);
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    return created;
  }, [novelId, queryClient]);

  const updateChapter = useCallback(async (chapterId: string, updates: Partial<Chapter>) => {
    const updated = await novelApiService.updateChapter(novelId, chapterId, updates);
    queryClient.setQueryData<Chapter[]>(['chapters', novelId], (prev = []) =>
      prev.map((item) => (item.id === chapterId ? updated : item)),
    );
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
    return updated;
  }, [novelId, queryClient]);

  const deleteChapter = useCallback(async (chapterId: string) => {
    await novelApiService.deleteChapter(novelId, chapterId);
    queryClient.setQueryData<Chapter[]>(['chapters', novelId], (prev = []) =>
      prev.filter((item) => item.id !== chapterId),
    );
    void queryClient.invalidateQueries({ queryKey: ['novel', novelId] });
  }, [novelId, queryClient]);

  return {
    chapters: chaptersQuery.data ?? [],
    isLoading: chaptersQuery.isLoading,
    error: chaptersQuery.error ?? null,
    refreshChapters,
    createChapter,
    updateChapter,
    deleteChapter,
  };
}
