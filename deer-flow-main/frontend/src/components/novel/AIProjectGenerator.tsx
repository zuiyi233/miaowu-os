'use client';

import { CheckCircle, Loader2, AlertCircle, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getBackendBaseURL } from '@/core/config';
import { cn } from '@/lib/utils';

export interface GenerationConfig {
  title: string;
  description: string;
  theme: string;
  genre: string | string[];
  narrative_perspective: string;
  target_words: number;
  chapter_count: number;
  character_count: number;
  outline_mode?: 'one-to-one' | 'one-to-many';
}

interface AIProjectGeneratorProps {
  config: GenerationConfig;
  storagePrefix: 'wizard' | 'inspiration';
  onComplete: (projectId: string) => void;
  onBack?: () => void;
  isMobile?: boolean;
  resumeProjectId?: string;
}

type GenerationStep = 'pending' | 'processing' | 'completed' | 'error';

interface GenerationSteps {
  worldBuilding: GenerationStep;
  careers: GenerationStep;
  characters: GenerationStep;
  outline: GenerationStep;
}

interface WorldBuildingResult {
  project_id: string;
  time_period: string;
  location: string;
  atmosphere: string;
  rules: string;
}

interface StreamCallbacks {
  onProgress: (msg: string, prog: number) => void;
  onResult: (result: unknown) => void;
  onError: (error: string) => void;
  onComplete?: () => void;
}

async function streamPost(url: string, body: Record<string, unknown>, callbacks: StreamCallbacks): Promise<unknown> {
  const backendBase = getBackendBaseURL();
  const response = await fetch(`${backendBase}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      try {
        const data = JSON.parse(trimmed.slice(5).trim());
        if (data.type === 'progress') {
          callbacks.onProgress(data.message || '', Math.min(100, Math.max(0, Number(data.progress) || 0)));
        } else if (data.type === 'result') {
          result = data.data;
          callbacks.onResult(result);
        } else if (data.type === 'error') {
          callbacks.onError(data.message || data.error || 'Unknown error');
        } else if (data.type === 'complete') {
          callbacks.onComplete?.();
        }
      } catch {
        // skip invalid JSON
      }
    }
  }

  return result;
}

export function AIProjectGenerator({
  config,
  storagePrefix,
  onComplete,
  isMobile = false,
  resumeProjectId
}: AIProjectGeneratorProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState<string>('');
  const [generationSteps, setGenerationSteps] = useState<GenerationSteps>({
    worldBuilding: 'pending',
    careers: 'pending',
    characters: 'pending',
    outline: 'pending'
  });
  const [generationData, setGenerationData] = useState<GenerationConfig | null>(null);
  const [worldBuildingResult, setWorldBuildingResult] = useState<WorldBuildingResult | null>(null);

  const storageKeys = {
    projectId: `${storagePrefix}_project_id`,
    generationData: `${storagePrefix}_generation_data`,
    currentStep: `${storagePrefix}_current_step`
  };

  const saveProgress = useCallback((pid: string, data: GenerationConfig, step: string) => {
    try {
      localStorage.setItem(storageKeys.projectId, pid);
      localStorage.setItem(storageKeys.generationData, JSON.stringify(data));
      localStorage.setItem(storageKeys.currentStep, step);
    } catch (e) {
      console.error('Failed to save progress:', e);
    }
  }, [storageKeys]);

  const clearStorage = useCallback(() => {
    localStorage.removeItem(storageKeys.projectId);
    localStorage.removeItem(storageKeys.generationData);
    localStorage.removeItem(storageKeys.currentStep);
  }, [storageKeys]);

  useEffect(() => {
    if (config) {
      if (resumeProjectId) {
        handleResumeGenerate(config, resumeProjectId);
      } else {
        handleAutoGenerate(config);
      }
    }
     
  }, [config, resumeProjectId]);

  const handleResumeGenerate = async (data: GenerationConfig, pidParam: string) => {
    try {
      setLoading(true);
      setProgress(0);
      setProgressMessage('检查项目状态...');
      setErrorDetails('');
      setGenerationData(data);
      setProjectId(pidParam);

      const backendBase = getBackendBaseURL();
      const response = await fetch(`${backendBase}/api/projects/${pidParam}`, { credentials: 'include' });
      if (!response.ok) throw new Error('获取项目信息失败');
      const project = await response.json();
      const wizardStep = project.wizard_step || 0;

      const worldResult: WorldBuildingResult = {
        project_id: pidParam,
        time_period: project.world_time_period || '',
        location: project.world_location || '',
        atmosphere: project.world_atmosphere || '',
        rules: project.world_rules || ''
      };

      if (wizardStep === 0) {
        toast.info('从世界观步骤开始生成...');
        setGenerationSteps({ worldBuilding: 'processing', careers: 'pending', characters: 'pending', outline: 'pending' });
        await resumeFromWorldBuilding(data);
      } else if (wizardStep === 1) {
        toast.info('世界观已完成，从职业体系步骤继续...');
        setGenerationSteps({ worldBuilding: 'completed', careers: 'processing', characters: 'pending', outline: 'pending' });
        setWorldBuildingResult(worldResult);
        setProgress(20);
        await resumeFromCareers(data, worldResult);
      } else if (wizardStep === 2) {
        toast.info('职业体系已完成，从角色步骤继续...');
        setGenerationSteps({ worldBuilding: 'completed', careers: 'completed', characters: 'processing', outline: 'pending' });
        setWorldBuildingResult(worldResult);
        setProgress(40);
        await resumeFromCharacters(data, worldResult);
      } else if (wizardStep === 3) {
        toast.info('角色已完成，从大纲步骤继续...');
        setGenerationSteps({ worldBuilding: 'completed', careers: 'completed', characters: 'completed', outline: 'processing' });
        setProgress(70);
        await resumeFromOutline(data, pidParam);
      } else {
        toast.success('项目已完成,正在跳转...');
        setProgress(100);
        onComplete(pidParam);
        setTimeout(() => router.push('/workspace/novel'), 1000);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      console.error('恢复生成失败:', msg);
      setErrorDetails(msg);
      toast.error('恢复生成失败：' + msg);
      setLoading(false);
    }
  };

  const resumeFromWorldBuilding = async (data: GenerationConfig) => {
    const genreString = Array.isArray(data.genre) ? data.genre.join('、') : data.genre;
    const worldResult = await streamPost('/api/wizard-stream/world-building', {
      title: data.title,
      description: data.description,
      theme: data.theme,
      genre: genreString,
      narrative_perspective: data.narrative_perspective,
      target_words: data.target_words,
      chapter_count: data.chapter_count,
      character_count: data.character_count,
      outline_mode: data.outline_mode || 'one-to-many',
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        setWorldBuildingResult(result as WorldBuildingResult);
        setGenerationSteps(prev => ({ ...prev, worldBuilding: 'completed' }));
      },
      onError: (error) => {
        console.error('世界观生成失败:', error);
        setErrorDetails(`世界观生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, worldBuilding: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await resumeFromCareers(data, worldResult as WorldBuildingResult);
  };

  const resumeFromCareers = async (data: GenerationConfig, worldResult: WorldBuildingResult) => {
    const pid = projectId || worldResult.project_id;
    setGenerationSteps(prev => ({ ...prev, careers: 'processing' }));
    setProgressMessage('正在生成职业体系...');

    await streamPost('/api/wizard-stream/career-system', { project_id: pid }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        const careerResult = result as Record<string, unknown>;
        const mainCareersCount = Number(careerResult.main_careers_count ?? 0);
        const subCareersCount = Number(careerResult.sub_careers_count ?? 0);
        console.log(`成功生成职业体系：主职业${mainCareersCount}个，副职业${subCareersCount}个`);
        setGenerationSteps(prev => ({ ...prev, careers: 'completed' }));
      },
      onError: (error) => {
        console.error('职业体系生成失败:', error);
        setErrorDetails(`职业体系生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, careers: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await resumeFromCharacters(data, worldResult);
  };

  const resumeFromCharacters = async (data: GenerationConfig, worldResult: WorldBuildingResult) => {
    const genreString = Array.isArray(data.genre) ? data.genre.join('、') : data.genre;
    const pid = projectId || worldResult.project_id;
    setGenerationSteps(prev => ({ ...prev, characters: 'processing' }));
    setProgressMessage('正在生成角色...');

    await streamPost('/api/wizard-stream/characters', {
      project_id: pid,
      count: data.character_count,
      world_context: {
        time_period: worldResult.time_period || '',
        location: worldResult.location || '',
        atmosphere: worldResult.atmosphere || '',
        rules: worldResult.rules || '',
      },
      theme: data.theme,
      genre: genreString,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        const characters = (result as Record<string, unknown>).characters;
        const characterCount = Array.isArray(characters) ? characters.length : 0;
        console.log(`成功生成${characterCount}个角色`);
        setGenerationSteps(prev => ({ ...prev, characters: 'completed' }));
      },
      onError: (error) => {
        console.error('角色生成失败:', error);
        setErrorDetails(`角色生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, characters: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await resumeFromOutline(data, pid);
  };

  const resumeFromOutline = async (data: GenerationConfig, pid: string) => {
    setGenerationSteps(prev => ({ ...prev, outline: 'processing' }));
    setProgressMessage('正在生成大纲...');

    await streamPost('/api/wizard-stream/outline', {
      project_id: pid,
      chapter_count: data.chapter_count,
      narrative_perspective: data.narrative_perspective,
      target_words: data.target_words,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: () => {
        console.log('大纲生成完成');
        setGenerationSteps(prev => ({ ...prev, outline: 'completed' }));
      },
      onError: (error) => {
        console.error('大纲生成失败:', error);
        setErrorDetails(`大纲生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, outline: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });

    setProgress(100);
    setProgressMessage('项目创建完成！正在跳转...');
    toast.success('项目创建成功！正在进入项目...');
    clearStorage();
    setLoading(false);
    onComplete(pid);
    setTimeout(() => router.push('/workspace/novel'), 1000);
  };

  const handleAutoGenerate = async (data: GenerationConfig) => {
    try {
      setLoading(true);
      setProgress(0);
      setProgressMessage('开始创建项目...');
      setErrorDetails('');
      setGenerationData(data);
      saveProgress('', data, 'generating');

      const genreString = Array.isArray(data.genre) ? data.genre.join('、') : data.genre;

      setGenerationSteps(prev => ({ ...prev, worldBuilding: 'processing' }));
      setProgressMessage('正在生成世界观...');

      const worldResult = await streamPost('/api/wizard-stream/world-building', {
        title: data.title,
        description: data.description,
        theme: data.theme,
        genre: genreString,
        narrative_perspective: data.narrative_perspective,
        target_words: data.target_words,
        chapter_count: data.chapter_count,
        character_count: data.character_count,
        outline_mode: data.outline_mode || 'one-to-many',
      }, {
        onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
        onResult: (result) => {
          setProjectId((result as WorldBuildingResult).project_id);
          setWorldBuildingResult(result as WorldBuildingResult);
          setGenerationSteps(prev => ({ ...prev, worldBuilding: 'completed' }));
        },
        onError: (error) => {
          console.error('世界观生成失败:', error);
          setErrorDetails(`世界观生成失败: ${error}`);
          setGenerationSteps(prev => ({ ...prev, worldBuilding: 'error' }));
          setLoading(false);
          throw new Error(error);
        },
      });

      const wResult = worldResult as WorldBuildingResult;
      if (!wResult?.project_id) throw new Error('项目创建失败：未获取到项目ID');

      const createdProjectId = wResult.project_id;
      setProjectId(createdProjectId);
      setWorldBuildingResult(wResult);
      saveProgress(createdProjectId, data, 'generating');

      setGenerationSteps(prev => ({ ...prev, careers: 'processing' }));
      setProgressMessage('正在生成职业体系...');

      await streamPost('/api/wizard-stream/career-system', { project_id: createdProjectId }, {
        onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
        onResult: (result) => {
          const careerResult = result as Record<string, unknown>;
          const mainCareersCount = Number(careerResult.main_careers_count ?? 0);
          const subCareersCount = Number(careerResult.sub_careers_count ?? 0);
          console.log(`成功生成职业体系：主职业${mainCareersCount}个，副职业${subCareersCount}个`);
          setGenerationSteps(prev => ({ ...prev, careers: 'completed' }));
        },
        onError: (error) => {
          console.error('职业体系生成失败:', error);
          setErrorDetails(`职业体系生成失败: ${error}`);
          setGenerationSteps(prev => ({ ...prev, careers: 'error' }));
          setLoading(false);
          throw new Error(error);
        },
      });

      setGenerationSteps(prev => ({ ...prev, characters: 'processing' }));
      setProgressMessage('正在生成角色...');

      await streamPost('/api/wizard-stream/characters', {
        project_id: createdProjectId,
        count: data.character_count,
        world_context: {
          time_period: wResult.time_period || '',
          location: wResult.location || '',
          atmosphere: wResult.atmosphere || '',
          rules: wResult.rules || '',
        },
        theme: data.theme,
        genre: genreString,
      }, {
        onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
        onResult: (result) => {
          console.log(`成功生成${((result as Record<string, unknown>).characters as unknown[])?.length || 0}个角色`);
          setGenerationSteps(prev => ({ ...prev, characters: 'completed' }));
        },
        onError: (error) => {
          console.error('角色生成失败:', error);
          setErrorDetails(`角色生成失败: ${error}`);
          setGenerationSteps(prev => ({ ...prev, characters: 'error' }));
          setLoading(false);
          throw new Error(error);
        },
      });

      setGenerationSteps(prev => ({ ...prev, outline: 'processing' }));
      setProgressMessage('正在生成大纲...');

      await streamPost('/api/wizard-stream/outline', {
        project_id: createdProjectId,
        chapter_count: data.chapter_count,
        narrative_perspective: data.narrative_perspective,
        target_words: data.target_words,
      }, {
        onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
        onResult: () => {
          console.log('大纲生成完成');
          setGenerationSteps(prev => ({ ...prev, outline: 'completed' }));
        },
        onError: (error) => {
          console.error('大纲生成失败:', error);
          setErrorDetails(`大纲生成失败: ${error}`);
          setGenerationSteps(prev => ({ ...prev, outline: 'error' }));
          setLoading(false);
          throw new Error(error);
        },
      });

      setProgress(100);
      setProgressMessage('项目创建完成！正在跳转...');
      toast.success('项目创建成功！正在进入项目...');
      clearStorage();
      setLoading(false);
      onComplete(createdProjectId);
      setTimeout(() => router.push('/workspace/novel'), 1000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      console.error('创建项目失败:', msg);
      setErrorDetails(msg);
      toast.error('创建项目失败：' + msg);
      setLoading(false);
    }
  };

  const handleSmartRetry = async () => {
    if (!generationData) { toast.warning('缺少生成数据'); return; }
    setLoading(true);
    setErrorDetails('');

    try {
      if (generationSteps.worldBuilding === 'error') {
        toast.info('从世界观步骤开始重新生成...');
        await retryFromWorldBuilding();
      } else if (generationSteps.careers === 'error') {
        toast.info('从职业体系步骤继续生成...');
        await retryFromCareers();
      } else if (generationSteps.characters === 'error') {
        toast.info('从角色步骤继续生成...');
        await retryFromCharacters();
      } else if (generationSteps.outline === 'error') {
        toast.info('从大纲步骤继续生成...');
        await retryFromOutline();
      }
    } catch (error) {
      console.error('智能重试失败:', error);
      const msg = error instanceof Error ? error.message : '未知错误';
      toast.error('重试失败：' + msg);
      setLoading(false);
    }
  };

  const retryFromWorldBuilding = async () => {
    if (!generationData) return;
    setGenerationSteps(prev => ({ ...prev, worldBuilding: 'processing' }));
    setProgressMessage('重新生成世界观...');
    const genreString = Array.isArray(generationData.genre) ? generationData.genre.join('、') : generationData.genre;

    const worldResult = await streamPost('/api/wizard-stream/world-building', {
      title: generationData.title,
      description: generationData.description,
      theme: generationData.theme,
      genre: genreString,
      narrative_perspective: generationData.narrative_perspective,
      target_words: generationData.target_words,
      chapter_count: generationData.chapter_count,
      character_count: generationData.character_count,
      outline_mode: generationData.outline_mode || 'one-to-many',
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        setProjectId((result as WorldBuildingResult).project_id);
        setWorldBuildingResult(result as WorldBuildingResult);
        setGenerationSteps(prev => ({ ...prev, worldBuilding: 'completed' }));
      },
      onError: (error) => {
        console.error('世界观生成失败:', error);
        setErrorDetails(`世界观生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, worldBuilding: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });

    const wResult = worldResult as WorldBuildingResult;
    if (!wResult?.project_id) throw new Error('项目创建失败：未获取到项目ID');
    await continueFromCareers(wResult);
  };

  const retryFromCareers = async () => {
    if (!worldBuildingResult) { toast.warning('缺少必要数据'); setLoading(false); return; }
    const pid = worldBuildingResult.project_id || projectId;
    if (!pid) { toast.warning('缺少项目ID'); setLoading(false); return; }

    setGenerationSteps(prev => ({ ...prev, careers: 'processing' }));
    setProgressMessage('重新生成职业体系...');

    await streamPost('/api/wizard-stream/career-system', { project_id: pid }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        console.log(`成功重新生成职业体系`);
        setGenerationSteps(prev => ({ ...prev, careers: 'completed' }));
      },
      onError: (error) => {
        console.error('职业体系生成失败:', error);
        setErrorDetails(`职业体系生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, careers: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await continueFromCharacters(worldBuildingResult);
  };

  const retryFromCharacters = async () => {
    if (!generationData || !worldBuildingResult) { toast.warning('缺少必要数据'); setLoading(false); return; }
    const pid = worldBuildingResult.project_id || projectId;
    if (!pid) { toast.warning('缺少项目ID'); setLoading(false); return; }

    setGenerationSteps(prev => ({ ...prev, characters: 'processing' }));
    setProgressMessage('重新生成角色...');
    const genreString = Array.isArray(generationData.genre) ? generationData.genre.join('、') : generationData.genre;

    await streamPost('/api/wizard-stream/characters', {
      project_id: pid,
      count: generationData.character_count,
      world_context: {
        time_period: worldBuildingResult.time_period || '',
        location: worldBuildingResult.location || '',
        atmosphere: worldBuildingResult.atmosphere || '',
        rules: worldBuildingResult.rules || '',
      },
      theme: generationData.theme,
      genre: genreString,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: (result) => {
        console.log(`成功重新生成${((result as Record<string, unknown>).characters as unknown[])?.length || 0}个角色`);
        setGenerationSteps(prev => ({ ...prev, characters: 'completed' }));
      },
      onError: (error) => {
        console.error('角色生成失败:', error);
        setErrorDetails(`角色生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, characters: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await continueFromOutline(pid);
  };

  const retryFromOutline = async () => {
    if (!generationData) { toast.warning('缺少生成数据'); setLoading(false); return; }
    const pid = worldBuildingResult?.project_id || projectId;
    if (!pid) { toast.warning('缺少项目ID'); setLoading(false); return; }

    setGenerationSteps(prev => ({ ...prev, outline: 'processing' }));
    setProgressMessage('重新生成大纲...');

    await streamPost('/api/wizard-stream/outline', {
      project_id: pid,
      chapter_count: generationData.chapter_count,
      narrative_perspective: generationData.narrative_perspective,
      target_words: generationData.target_words,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: () => {
        console.log('大纲重新生成完成');
        setGenerationSteps(prev => ({ ...prev, outline: 'completed' }));
      },
      onError: (error) => {
        console.error('大纲生成失败:', error);
        setErrorDetails(`大纲生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, outline: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });

    setProgress(100);
    setProgressMessage('项目创建完成！正在跳转...');
    toast.success('项目创建成功！正在进入项目...');
    setLoading(false);
    onComplete(pid);
    setTimeout(() => router.push('/workspace/novel'), 1000);
  };

  const continueFromCareers = async (worldResult: WorldBuildingResult) => {
    if (!generationData || !worldResult?.project_id) return;
    const pid = worldResult.project_id;
    setGenerationSteps(prev => ({ ...prev, careers: 'processing' }));
    setProgressMessage('正在生成职业体系...');

    await streamPost('/api/wizard-stream/career-system', { project_id: pid }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: () => { setGenerationSteps(prev => ({ ...prev, careers: 'completed' })); },
      onError: (error) => {
        setErrorDetails(`职业体系生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, careers: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await continueFromCharacters(worldResult);
  };

  const continueFromCharacters = async (worldResult: WorldBuildingResult) => {
    if (!generationData || !worldResult?.project_id) return;
    const pid = worldResult.project_id;
    const genreString = Array.isArray(generationData.genre) ? generationData.genre.join('、') : generationData.genre;
    setGenerationSteps(prev => ({ ...prev, characters: 'processing' }));
    setProgressMessage('正在生成角色...');

    await streamPost('/api/wizard-stream/characters', {
      project_id: pid,
      count: generationData.character_count,
      world_context: {
        time_period: worldResult.time_period || '',
        location: worldResult.location || '',
        atmosphere: worldResult.atmosphere || '',
        rules: worldResult.rules || '',
      },
      theme: generationData.theme,
      genre: genreString,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: () => { setGenerationSteps(prev => ({ ...prev, characters: 'completed' })); },
      onError: (error) => {
        setErrorDetails(`角色生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, characters: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });
    await continueFromOutline(pid);
  };

  const continueFromOutline = async (pid: string) => {
    if (!generationData || !pid) return;
    setGenerationSteps(prev => ({ ...prev, outline: 'processing' }));
    setProgressMessage('正在生成大纲...');

    await streamPost('/api/wizard-stream/outline', {
      project_id: pid,
      chapter_count: generationData.chapter_count,
      narrative_perspective: generationData.narrative_perspective,
      target_words: generationData.target_words,
    }, {
      onProgress: (msg, prog) => { setProgress(prog); setProgressMessage(msg); },
      onResult: () => { setGenerationSteps(prev => ({ ...prev, outline: 'completed' })); },
      onError: (error) => {
        setErrorDetails(`大纲生成失败: ${error}`);
        setGenerationSteps(prev => ({ ...prev, outline: 'error' }));
        setLoading(false);
        throw new Error(error);
      },
    });

    setProgress(100);
    setProgressMessage('项目创建完成！正在跳转...');
    toast.success('项目创建成功！正在进入项目...');
    setLoading(false);
    onComplete(pid);
    setTimeout(() => router.push('/workspace/novel'), 1000);
  };

  const getStepStatus = (step: GenerationStep) => {
    if (step === 'completed') return { icon: <CheckCircle className="w-4 h-4" />, color: 'text-green-600', text: '已完成', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
    if (step === 'processing') return { icon: <Loader2 className="w-4 h-4 animate-spin" />, color: 'text-blue-600', text: '进行中', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' };
    if (step === 'error') return { icon: <X className="w-4 h-4" />, color: 'text-red-600', text: '失败', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
    return { icon: <span className="w-2 h-2 rounded-full border border-muted-foreground/30 inline-block" />, color: 'text-muted-foreground', text: '等待中', bg: 'bg-muted/50', border: 'border-border', badge: 'bg-muted text-muted-foreground' };
  };

  const hasError = generationSteps.worldBuilding === 'error' || generationSteps.careers === 'error' || generationSteps.characters === 'error' || generationSteps.outline === 'error';

  const stepItems = [
    { key: 'worldBuilding', label: '生成世界观', step: generationSteps.worldBuilding },
    { key: 'careers', label: '生成职业体系', step: generationSteps.careers },
    { key: 'characters', label: '生成角色', step: generationSteps.characters },
    { key: 'outline', label: '生成大纲', step: generationSteps.outline },
  ];

  return (
    <div className={cn(
      "flex flex-col items-center justify-center mx-auto max-w-3xl overflow-hidden",
      hasError ? "justify-start" : "justify-center",
      isMobile ? "min-h-[calc(100dvh-96px)] py-1 px-0" : "min-h-[calc(100dvh-128px)] py-2 px-0"
    )}>
      <Card className={cn(
        "mb-3 rounded-2xl border shadow-lg text-center",
        hasError ? "border-red-200 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-background" : "border-primary/20 bg-gradient-to-br from-primary/5 to-white dark:from-primary/10 dark:to-background"
      )}>
        <CardContent className={cn("p-4", isMobile && "p-4")}>
          <h3 className={cn("mb-2 font-semibold text-foreground break-words", isMobile ? "text-lg" : "text-xl")}>
            正在为《{config.title}》生成内容
          </h3>
          <p className={cn("mx-auto max-w-md text-sm text-muted-foreground leading-relaxed break-words", isMobile ? "text-xs" : "text-sm")}>
            {hasError
              ? '生成流程中断，已保留当前进度与上下文信息，可从失败步骤继续重试。'
              : '系统会依次生成世界观、职业体系、角色与大纲，请耐心等待。'}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-3 w-full rounded-2xl border shadow-lg bg-gradient-to-b from-background to-primary/[0.02]">
        <CardContent className={cn(isMobile ? "p-3.5" : "p-5")}>
          <div className={cn(
            "mb-4 rounded-xl border p-3.5",
            hasError ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" : "border-primary/20 bg-muted/50"
          )}>
            <div className={cn("mb-2.5 flex items-start gap-2.5", isMobile && "flex-col")}>
              <div className="flex-1 text-left">
                <p className="mb-1.5 text-xs tracking-wide text-muted-foreground">当前进度</p>
                <p className={cn("m-0 leading-relaxed break-words text-foreground", isMobile ? "text-[13px]" : "text-[15px]")}>
                  {progressMessage || '准备生成...'}
                </p>
              </div>
              <div className={cn("shrink-0", isMobile ? "text-left" : "text-right")}>
                <span className={cn(
                  "font-bold leading-none",
                  hasError ? "text-destructive" : progress === 100 ? "text-green-600" : "text-primary",
                  isMobile ? "text-2xl" : "text-3xl"
                )}>
                  {progress}%
                </span>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {errorDetails && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50/50 p-3.5 text-left dark:border-red-800 dark:bg-red-950/20">
              <p className="mb-2 font-semibold text-destructive">错误详情</p>
              <p className="text-sm leading-relaxed text-muted-foreground break-words">{errorDetails}</p>
            </div>
          )}

          <div className="grid gap-2.5">
            {stepItems.map(({ key, label, step }) => {
              const status = getStepStatus(step);
              return (
                <div key={key} className={cn("flex items-center justify-between gap-3 rounded-xl border p-3 overflow-hidden", status.bg, status.border)}>
                  <div className="flex flex-1 min-w-0 items-center gap-3">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm", status.color, "bg-current/10")}>
                      {status.icon}
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                      <p className={cn("block font-medium break-words text-foreground", step === 'processing' ? "font-semibold" : "font-medium", isMobile ? "text-[13px]" : "text-sm")}>{label}</p>
                      <p className={cn("text-xs", step === 'pending' ? "text-muted-foreground" : status.color)}>{status.text}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn("shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-semibold", status.badge)}>
                    {status.text}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <p className={cn(hasError ? "mb-3.5" : "mb-0", "text-center text-sm text-muted-foreground opacity-90 break-words", isMobile && "text-xs")}>
        {hasError ? '可点击下方智能重试，从失败节点继续生成，避免重复执行已完成步骤。' : '请勿关闭页面，生成完成后将自动进入项目详情页。'}
      </p>

      {hasError && (
        <Button size="lg" onClick={handleSmartRetry} disabled={loading} className={cn("min-w-[160px] h-11 rounded-xl shadow-lg", isMobile && "w-full")}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          智能重试
        </Button>
      )}
    </div>
  );
}
