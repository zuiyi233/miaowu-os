"use client";

import {
  AlertCircle,
  BookOpen,
  Globe,
  Loader2,
  PencilLine,
  Sparkles,
  Square,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { novelApiService, type NovelStreamEvent } from "@/core/novel/novel-api";
import { useNovelStore } from "@/core/novel/useNovelStore";

type GenerationType = "worldview" | "outline" | "chapter" | "characters";

interface GenerationResult {
  content: string;
  status: "idle" | "streaming" | "success" | "error";
  error?: string;
}

interface ChapterOption {
  id: string;
  title: string;
  order?: number;
}

const GENERATION_TYPE_KEYS: {
  value: GenerationType;
  labelKey: "worldview" | "outline" | "chapters" | "characters";
  icon: React.ReactNode;
  descKey: string;
}[] = [
  {
    value: "worldview",
    labelKey: "worldview",
    icon: <Globe className="h-4 w-4" />,
    descKey: "worldviewDesc",
  },
  {
    value: "outline",
    labelKey: "outline",
    icon: <PencilLine className="h-4 w-4" />,
    descKey: "outlineDesc",
  },
  {
    value: "chapter",
    labelKey: "chapters",
    icon: <BookOpen className="h-4 w-4" />,
    descKey: "chapterDesc",
  },
  {
    value: "characters",
    labelKey: "characters",
    icon: <Users className="h-4 w-4" />,
    descKey: "charactersDesc",
  },
];

export function GeneratePanel({ novelId }: { novelId: string }) {
  const [generationType, setGenerationType] =
    useState<GenerationType>("outline");
  const [prompt, setPrompt] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [result, setResult] = useState<GenerationResult>({
    content: "",
    status: "idle",
  });
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number>(0);
  const pendingChunksRef = useRef("");
  const { t } = useI18n();
  const setActiveChapterId = useNovelStore((s) => s.setActiveChapterId);
  const setViewMode = useNovelStore((s) => s.setViewMode);

  useEffect(() => {
    let cancelled = false;
    setChapterId("");
    setChapters([]);
    const load = async () => {
      try {
        const chs = await novelApiService.getChapters(novelId);
        if (!cancelled && chs.length > 0) {
          const opts = chs.map((c: ChapterOption) => ({
            id: c.id,
            title: c.title,
            order: c.order,
          }));
          setChapters(opts);
          if (opts[0]) setChapterId(opts[0].id);
        }
      } catch (error) {
        console.error("Failed to load chapters:", error);
        if (!cancelled) {
          setChapters([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [novelId]);

  const flushChunks = useCallback(() => {
    const accumulated = pendingChunksRef.current;
    if (accumulated) {
      setResult((prev) => ({ ...prev, content: prev.content + accumulated }));
      pendingChunksRef.current = "";
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(flushChunks);
  }, [flushChunks]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    setResult({ content: "", status: "streaming" });
    pendingChunksRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let stream: AsyncGenerator<NovelStreamEvent>;

      switch (generationType) {
        case "worldview":
          stream = await novelApiService.generateOutlinesStream(
            novelId,
            { prompt, mode: "worldview" },
            controller.signal,
          );
          break;
        case "outline":
          stream = await novelApiService.generateOutlinesStream(
            novelId,
            { prompt },
            controller.signal,
          );
          break;
        case "chapter": {
          const targetChapterId = chapterId || chapters[0]?.id;
          if (!targetChapterId) {
            setResult({
              content: "",
              status: "error",
              error: t.novel.noChapters,
            });
            return;
          }
          stream = await novelApiService.generateChapterStream(
            novelId,
            targetChapterId,
            { prompt },
            controller.signal,
          );
          break;
        }
        case "characters":
          stream = await novelApiService.generateCharactersStream(
            novelId,
            { prompt },
            controller.signal,
          );
          break;
        default:
          throw new Error("Unknown generation type");
      }

      for await (const event of stream) {
        const record = event as Record<string, unknown>;
        const chunk =
          (typeof record.content === "string" ? record.content : "") ||
          (typeof record.text === "string" ? record.text : "") ||
          (typeof record.delta === "string" ? record.delta : "");
        if (chunk) {
          pendingChunksRef.current += chunk;
          scheduleFlush();
        }
      }

      flushChunks();
      setResult((prev) => ({ ...prev, status: "success" }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        flushChunks();
        setResult((prev) =>
          prev.content.length > 0
            ? { ...prev, status: "success" }
            : { content: "", status: "idle" },
        );
        return;
      }
      const message =
        error instanceof Error ? error.message : t.novel.generationFailed;
      setResult({ content: "", status: "error", error: message });
    } finally {
      abortRef.current = null;
    }
  }, [
    generationType,
    novelId,
    prompt,
    chapterId,
    chapters,
    t,
    scheduleFlush,
    flushChunks,
  ]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleReset = useCallback(() => {
    setResult({ content: "", status: "idle" });
    setPrompt("");
  }, []);

  const handleApplyToChapter = useCallback(() => {
    const targetId = chapterId || chapters[0]?.id;
    if (targetId) {
      setActiveChapterId(targetId);
      setViewMode("editor");
    }
  }, [chapterId, chapters, setActiveChapterId, setViewMode]);

  const handleApplyToOutline = useCallback(() => {
    setViewMode("outline");
  }, [setViewMode]);

  const isGenerating = result.status === "streaming";

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs font-medium">
              {t.novel.generationType}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {GENERATION_TYPE_KEYS.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setGenerationType(type.value)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    generationType === type.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  {type.icon}
                  <span>{t.novel[type.labelKey]}</span>
                </button>
              ))}
            </div>
          </div>

          {generationType === "chapter" && chapters.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs font-medium">
                {t.novel.targetChapter}
              </Label>
              <Select value={chapterId} onValueChange={setChapterId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.novel.selectChapter} />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.title ||
                        `${t.novel.chapterFallback} ${ch.order ?? ""}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {generationType === "chapter" && chapters.length === 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {t.novel.noChapters}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs font-medium">
              {t.novel.creativeRequirements}
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.novel.creativeRequirementsPlaceholder}
              className="min-h-[80px] resize-none text-sm"
              disabled={isGenerating}
            />
          </div>

          {result.status === "error" && result.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {result.error}
              </AlertDescription>
            </Alert>
          )}

          {result.status === "success" && result.content.length > 0 && (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {t.novel.generationComplete}
              </AlertDescription>
            </Alert>
          )}

          {result.content.length > 0 && (
            <div className="bg-muted/30 rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {isGenerating ? t.novel.generating : t.novel.generationResult}
                </Badge>
                {isGenerating && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <ScrollArea className="max-h-[300px]">
                <div className="text-sm whitespace-pre-wrap">
                  {result.content}
                </div>
              </ScrollArea>
              {result.status === "success" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {generationType === "chapter" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApplyToChapter}
                    >
                      {t.novel.applyToChapter}
                    </Button>
                  )}
                  {(generationType === "outline" ||
                    generationType === "worldview") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApplyToOutline}
                    >
                      {t.novel.applyToOutline}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex gap-2">
          {isGenerating ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleAbort}
              className="w-full"
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t.novel.stopGeneration}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={generationType === "chapter" && chapters.length === 0}
                className="flex-1"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t.novel.startGeneration}
              </Button>
              {result.status !== "idle" && (
                <Button size="sm" variant="outline" onClick={handleReset}>
                  {t.novel.reset}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
