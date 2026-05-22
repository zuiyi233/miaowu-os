'use client';

import { AlertCircle, Sparkles, Heart, Download, Eye, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

import {
  buildPromptTemplateCreatePayload,
  buildPromptTemplateDeleteUrl,
  buildPromptTemplatesUrl,
  buildPromptWorkshopItemsUrl,
  buildPromptWorkshopLikeUrl,
  extractPromptTemplates,
  extractWorkshopItems,
} from '@/components/novel/prompt-workshop-api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fetch as authFetch } from '@/core/api/fetcher';
import { getBackendBaseURL } from '@/core/config';
import { useI18n } from '@/core/i18n/hooks';
import { cn } from '@/lib/utils';

interface PromptTemplate {
  id: string; template_name: string; template_content: string;
  description: string; category: string; parameters?: string;
  is_active: boolean; is_system_default: boolean;
}

interface PromptWorkshopProps {
  projectId?: string;
}

type WorkshopStatus = 'checking' | 'available' | 'degraded' | 'unavailable';

interface WorkshopHealth {
  status: WorkshopStatus;
  mode?: string;
  cloudConnected?: boolean;
  message?: string;
  checkedAt: number;
}

const HEALTH_CACHE_MS = 30_000;

function pickString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function normalize(t: Record<string, unknown>): PromptTemplate {
  return {
    id: pickString(t, 'template_key', 'id') ?? '',
    template_name: pickString(t, 'template_name', 'name') ?? '',
    template_content: pickString(t, 'template_content', 'prompt_content', 'content') ?? '',
    description: pickString(t, 'description') ?? '',
    category: pickString(t, 'category') ?? 'general',
    parameters: pickString(t, 'parameters'),
    is_active: Boolean(t.is_active ?? true), is_system_default: Boolean(t.is_system_default),
  };
}

export function PromptWorkshop({ projectId }: PromptWorkshopProps) {
  const backendBase = getBackendBaseURL() || '';
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [myItems, setMyItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [tab, setTab] = useState<'community' | 'mine'>('community');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ template_name: '', template_content: '', description: '', category: 'general', parameters: '' });
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [health, setHealth] = useState<WorkshopHealth>({ status: 'checking', checkedAt: 0 });
  const healthRef = useRef(health);
  healthRef.current = health;
  const { t } = useI18n();

  const checkHealth = useCallback(async () => {
    const now = Date.now();
    if (healthRef.current.status !== 'checking' && now - healthRef.current.checkedAt < HEALTH_CACHE_MS) {
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await authFetch(`${backendBase}/api/prompt-workshop/status`, { signal: controller.signal });
      if (!res.ok) {
        setHealth({ status: 'unavailable', message: `${t.novel.serviceReturnError} (${res.status})`, checkedAt: now });
        return;
      }
      const data = await res.json() as Record<string, unknown>;
      const mode = typeof data.mode === 'string' ? data.mode : 'client';
      const cloudConnected = data.cloud_connected === true;

      if (mode === 'server') {
        setHealth({ status: 'available', mode, checkedAt: now });
      } else if (cloudConnected) {
        setHealth({ status: 'available', mode, cloudConnected: true, checkedAt: now });
      } else {
        const msg = typeof data.message === 'string' ? data.message : t.novel.workshopCloudUnreachable;
        setHealth({ status: 'degraded', mode, cloudConnected: false, message: msg, checkedAt: now });
      }
    } catch {
      setHealth({ status: 'unavailable', message: t.novel.workshopNetworkError, checkedAt: now });
    } finally {
      clearTimeout(timeoutId);
    }
  }, [backendBase, t]);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadCommunity = useCallback(async () => {
    if (healthRef.current.status === 'unavailable') return;
    try {
      setLoading(true);
      setCommunityError(null);
      const res = await authFetch(
        buildPromptWorkshopItemsUrl(backendBase, { searchTerm: debouncedSearch, categoryFilter }),
      );
      if (res.ok) {
        const payload = await res.json();
        setItems(extractWorkshopItems(payload).map(normalize));
      } else {
        setCommunityError(`${t.novel.loadFailed} (${res.status})`);
      }
    } catch {
      setCommunityError(t.novel.networkRequestFailed);
    } finally { setLoading(false); }
  }, [backendBase, debouncedSearch, categoryFilter]);

  const loadMyPrompts = useCallback(async () => {
    try {
      const res = await authFetch(buildPromptTemplatesUrl(backendBase));
      if (res.ok) {
        const payload = await res.json();
        setMyItems(extractPromptTemplates(payload).map(normalize));
      } else {
        toast.error(t.novel.loadMyTemplatesFailed);
      }
    } catch {
      toast.error(t.novel.loadMyTemplatesNetworkError);
    }
  }, [backendBase]);

  useEffect(() => { if (tab === 'community') loadCommunity(); else loadMyPrompts(); }, [tab, loadCommunity, loadMyPrompts]);

  const handleCreate = async () => {
    try {
      const res = await authFetch(buildPromptTemplatesUrl(backendBase), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPromptTemplateCreatePayload(form, projectId)),
      });
      if (!res.ok) throw new Error(t.novel.createPromptFailed);
      toast.success(t.novel.promptCreated); setIsCreateOpen(false);
      setForm({ template_name: '', template_content: '', description: '', category: 'general', parameters: '' }); loadMyPrompts();
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.operationFailed); }
  };

  const handleToggleFavorite = async (id: string) => {
    try {
      await authFetch(buildPromptWorkshopLikeUrl(backendBase, id), { method: 'POST' });
      loadCommunity();
    } catch {
      toast.error(t.novel.favoriteFailed);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.novel.confirmDeleteTemplate)) return;
    try {
      const template = myItems.find((item) => item.id === id);
      const res = await authFetch(buildPromptTemplateDeleteUrl(backendBase, template?.id || id), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(t.novel.deleteFailed); toast.success(t.novel.deleted); loadMyPrompts();
    } catch (err) { toast.error(err instanceof Error ? err.message : t.novel.deleteFailed); }
  };

  const currentList = tab === 'community' ? items : myItems;

  if (health.status === 'checking') {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        {t.novel.workshopChecking}
      </div>
    );
  }

  if (health.status === 'unavailable') {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5" /> {t.novel.workshopTitle}</h2>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">{t.novel.workshopUnavailable}</p>
            <p className="mt-1 text-xs">{health.message || t.novel.workshopNetworkError}</p>
            <p className="mt-1 text-xs">{t.novel.workshopUnavailableHint}</p>
          </AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" onClick={() => { setHealth({ status: 'checking', checkedAt: 0 }); checkHealth(); }}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />{t.novel.workshopRetryCheck}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5" /> {t.novel.workshopTitle}</h2>
        <div className="flex items-center gap-2">
          {health.status === 'degraded' && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
              {t.novel.workshopDegraded}
            </Badge>
          )}
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />{t.novel.customTemplate}
          </Button>
        </div>
      </div>

      {health.status === 'degraded' && health.message && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {health.message}{t.novel.workshopDegradedHint}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger value="community" disabled={health.status === 'degraded'}>
                  {t.novel.communityTab}
                </TabsTrigger>
              </TooltipTrigger>
              {health.status === 'degraded' && (
                <TooltipContent>
                  <p className="text-xs">{t.novel.communityTabDisabledHint}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <TabsTrigger value="mine">{t.novel.mineTab}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <div className="flex gap-2 mb-4">
            <Input placeholder={t.novel.searchPrompts} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-[240px]" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder={t.novel.allCategories} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.novel.allCategories}</SelectItem>
                <SelectItem value="writing">{t.novel.categoryWriting}</SelectItem>
                <SelectItem value="worldbuilding">{t.novel.categoryWorldbuilding}</SelectItem>
                <SelectItem value="character">{t.novel.categoryCharacter}</SelectItem>
                <SelectItem value="plot">{t.novel.categoryPlot}</SelectItem>
                <SelectItem value="dialogue">{t.novel.categoryDialogue}</SelectItem>
              </SelectContent>
            </Select>
            {(tab === 'community') && <Button size="sm" variant="outline" onClick={loadCommunity}><RefreshCw className="w-3.5 h-3.5 mr-1" />{t.novel.refresh}</Button>}
          </div>

          {communityError && tab === 'community' && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{communityError}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground py-8">{t.novel.loading}</p>
          ) : currentList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentList.map((item) => (
                <Card key={item.id} className={cn(!item.is_active && "opacity-60")}>
                  <CardContent className="pt-4 space-y-2.5">
                    <div className="flex items-start justify-between">
                      <h3 className="font-medium text-sm line-clamp-1">{item.template_name}</h3>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{item.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description || t.novel.noDescription}</p>
                    <pre className="text-[11px] bg-muted/50 p-2 rounded font-mono max-h-[80px] overflow-hidden line-clamp-3 whitespace-pre-wrap break-all">
                      {item.template_content.slice(0, 150)}
                    </pre>
                    <div className="flex items-center gap-1 pt-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewId(item.id)}>
                        <Eye className="w-3 h-3 mr-1" />{t.novel.preview}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(item.template_content).then(() => toast(t.novel.copied))}>
                        <Download className="w-3 h-3 mr-1" />{t.novel.copy}
                      </Button>
                      {tab === 'community' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleToggleFavorite(item.id)}>
                          <Heart className="w-3 h-3 mr-1" />{t.novel.favorite}
                        </Button>
                      )}
                      {tab === 'mine' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-3 h-3 mr-1" />{t.common.delete}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">{tab === 'community' ? t.novel.noCommunityTemplates : t.novel.noMyTemplates}</p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!previewId} onOpenChange={(v) => !v && setPreviewId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{currentList.find((i) => i.id === previewId)?.template_name}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[400px] pr-2 -mr-2">
            <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/30 p-4 rounded">{currentList.find((i) => i.id === previewId)?.template_content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t.novel.createCustomTemplate}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{t.novel.templateName}</Label><Input value={form.template_name} onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))} /></div>
            <div><Label>{t.novel.allCategories}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{t.novel.categoryGeneral}</SelectItem><SelectItem value="writing">{t.novel.categoryWriting}</SelectItem>
                  <SelectItem value="worldbuilding">{t.novel.categoryWorldbuilding}</SelectItem><SelectItem value="character">{t.novel.categoryCharacter}</SelectItem>
                  <SelectItem value="plot">{t.novel.categoryPlot}</SelectItem><SelectItem value="dialogue">{t.novel.categoryDialogue}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t.novel.promptDescription}</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>{t.novel.promptContent}</Label><Textarea rows={6} value={form.template_content} onChange={(e) => setForm((f) => ({ ...f, template_content: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>{t.novel.cancel}</Button>
            <Button onClick={handleCreate}>{t.novel.create}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
