"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import {
  ImagesApiError,
  generateImage,
  getImageJobErrorMessage,
  isActiveImageJobStatus,
  listImageJobs,
  type ImageGenerateRequest,
  type ImageJob,
  type ImageJobStatus,
} from "@/core/images";

const DEFAULT_OPTION = "backend-default";
const HISTORY_POLL_INTERVAL_MS = 3_000;

const SIZE_OPTIONS = [
  { value: DEFAULT_OPTION, label: "后端默认" },
  { value: "1024x1024", label: "1024 x 1024" },
  { value: "1536x1024", label: "1536 x 1024" },
  { value: "1024x1536", label: "1024 x 1536" },
];

const ASPECT_RATIO_OPTIONS = [
  { value: DEFAULT_OPTION, label: "不指定" },
  { value: "1:1", label: "1:1" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

const QUALITY_OPTIONS = [
  { value: DEFAULT_OPTION, label: "后端默认" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function mergeJobs(incoming: ImageJob[], current: ImageJob[]): ImageJob[] {
  const merged = new Map<string, ImageJob>();
  for (const job of [...incoming, ...current]) {
    if (!merged.has(job.id)) {
      merged.set(job.id, job);
    }
  }
  return [...merged.values()].sort((left, right) => {
    const leftTime = left.updated_at ?? left.created_at ?? "";
    const rightTime = right.updated_at ?? right.created_at ?? "";
    return rightTime.localeCompare(leftTime);
  });
}

function formatJobTime(value: string | null): string {
  if (!value) return "未记录时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatElapsed(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function statusLabel(status: ImageJobStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未知";
  }
}

function statusVariant(
  status: ImageJobStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "queued":
    case "running":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function getRequestText(
  requestParams: Record<string, unknown>,
  key: string,
): string | null {
  const value = requestParams[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function jobSubtitle(job: ImageJob): string {
  const size = getRequestText(job.request_params, "size");
  const aspectRatio = getRequestText(job.request_params, "aspect_ratio");
  const quality = getRequestText(job.request_params, "quality");
  const count = getRequestText(job.request_params, "n");

  return [job.model, size, aspectRatio, quality, count ? `n=${count}` : null]
    .filter(Boolean)
    .join(" · ");
}

function jobPreviewText(job: ImageJob): string {
  if (job.prompt.trim().length > 0) {
    return job.prompt;
  }
  const errorMessage = getImageJobErrorMessage(job);
  if (errorMessage) {
    return errorMessage;
  }
  return "无 prompt 内容";
}

export default function ImagesPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState(DEFAULT_OPTION);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_OPTION);
  const [quality, setQuality] = useState(DEFAULT_OPTION);
  const [count, setCount] = useState("1");

  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );
  const hasActiveJobs = useMemo(
    () => jobs.some((job) => isActiveImageJobStatus(job.status)),
    [jobs],
  );

  useEffect(() => {
    document.title = "图片生成 - Miaowu OS";
  }, []);

  const refreshJobs = useCallback(
    async ({
      silent = false,
      signal,
      preferredJobId,
    }: {
      silent?: boolean;
      signal?: AbortSignal;
      preferredJobId?: string | null;
    } = {}) => {
      if (!silent) {
        setIsHistoryLoading(true);
      }
      setHistoryError(null);
      try {
        const nextJobs = await listImageJobs(signal);
        setJobs(nextJobs);
        setSelectedJobId((current) => {
          if (preferredJobId && nextJobs.some((job) => job.id === preferredJobId)) {
            return preferredJobId;
          }
          if (current && nextJobs.some((job) => job.id === current)) {
            return current;
          }
          return nextJobs[0]?.id ?? null;
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        const message =
          error instanceof ImagesApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "加载图片历史失败";
        setHistoryError(message);
      } finally {
        if (!silent) {
          setIsHistoryLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshJobs({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshJobs]);

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshJobs({ silent: true, preferredJobId: selectedJobId });
    }, HISTORY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refreshJobs, selectedJobId]);

  const handleGenerate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedPrompt = prompt.trim();
      const parsedCount = Number.parseInt(count, 10);
      if (!trimmedPrompt) {
        setSubmitError("Prompt 不能为空。");
        return;
      }
      if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 10) {
        setSubmitError("数量 n 必须是 1 到 10 之间的整数。");
        return;
      }

      const payload: ImageGenerateRequest = {
        prompt: trimmedPrompt,
        n: parsedCount,
      };
      if (model.trim().length > 0) {
        payload.model = model.trim();
      }
      if (size !== DEFAULT_OPTION) {
        payload.size = size;
      }
      if (aspectRatio !== DEFAULT_OPTION) {
        payload.aspect_ratio = aspectRatio;
      }
      if (quality !== DEFAULT_OPTION) {
        payload.quality = quality;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const job = await generateImage(payload);
        setJobs((current) => mergeJobs([job], current));
        setSelectedJobId(job.id);
        toast.success(
          isActiveImageJobStatus(job.status) ? "已提交图片生成任务" : "图片生成已返回结果",
        );
        void refreshJobs({ silent: true, preferredJobId: job.id });
      } catch (error) {
        const message =
          error instanceof ImagesApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "提交生成失败";
        setSubmitError(message);
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [aspectRatio, count, model, prompt, quality, refreshJobs, size],
  );

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("图片 URL 已复制");
    } catch {
      toast.error("复制 URL 失败");
    }
  }, []);

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-hidden">
        <ScrollArea className="size-full">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4">
            <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ImageIcon className="size-4" />
                    图片生成
                  </CardTitle>
                  <CardDescription>
                    通过网关提交文生图请求，历史记录直接从 `/api/v1/images/jobs` 刷新。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="space-y-4" onSubmit={handleGenerate}>
                    <div className="space-y-2">
                      <Label htmlFor="images-prompt">Prompt</Label>
                      <Textarea
                        id="images-prompt"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="描述想生成的画面、镜头、材质、光线或构图。"
                        className="min-h-32"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="images-model">Model</Label>
                      <Input
                        id="images-model"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="例如 gpt-image-1"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Size</Label>
                        <Select
                          value={size}
                          onValueChange={(value) => {
                            setSize(value);
                            if (value !== DEFAULT_OPTION) {
                              setAspectRatio(DEFAULT_OPTION);
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择尺寸" />
                          </SelectTrigger>
                          <SelectContent>
                            {SIZE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ratio</Label>
                        <Select
                          value={aspectRatio}
                          onValueChange={(value) => {
                            setAspectRatio(value);
                            if (value !== DEFAULT_OPTION) {
                              setSize(DEFAULT_OPTION);
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择比例" />
                          </SelectTrigger>
                          <SelectContent>
                            {ASPECT_RATIO_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Quality</Label>
                        <Select value={quality} onValueChange={setQuality}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择质量" />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      `size` 与 `aspect_ratio` 互斥。选中一个后，另一个会回到默认值。
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="images-count">n</Label>
                      <Input
                        id="images-count"
                        type="number"
                        min={1}
                        max={10}
                        value={count}
                        onChange={(event) => setCount(event.target.value)}
                      />
                    </div>
                    {submitError ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        {submitError}
                      </div>
                    ) : null}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <LoaderCircleIcon className="size-4 animate-spin" />
                          提交中
                        </>
                      ) : (
                        "开始生成"
                      )}
                    </Button>
                  </form>

                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">当前状态</span>
                      <Badge variant={isSubmitting ? "secondary" : "outline"}>
                        {isSubmitting ? "请求发送中" : "空闲"}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      历史任务 {jobs.length} 条
                      {hasActiveJobs ? "，包含进行中的任务" : "。"}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <Card className="lg:min-h-[42rem]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">历史</CardTitle>
                        <CardDescription>最新任务优先，生成后自动刷新。</CardDescription>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshJobs()}
                        disabled={isHistoryLoading}
                      >
                        <RefreshCwIcon
                          className={`size-4 ${isHistoryLoading ? "animate-spin" : ""}`}
                        />
                        刷新
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    {historyError ? (
                      <div className="px-6 pb-4 text-sm text-destructive">
                        {historyError}
                      </div>
                    ) : null}
                    <ScrollArea className="h-[26rem] lg:h-[calc(100vh-14rem)]">
                      <div className="flex flex-col">
                        {jobs.map((job) => {
                          const active = selectedJob?.id === job.id;
                          const preview = jobPreviewText(job);
                          return (
                            <button
                              key={job.id}
                              type="button"
                              onClick={() => setSelectedJobId(job.id)}
                              className={`border-b px-4 py-3 text-left transition-colors ${
                                active ? "bg-accent/50" : "hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">
                                    {preview}
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {jobSubtitle(job) || "使用后端默认参数"}
                                  </div>
                                </div>
                                <Badge variant={statusVariant(job.status)}>
                                  {statusLabel(job.status)}
                                </Badge>
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{formatJobTime(job.created_at)}</span>
                                <span>·</span>
                                <span>{job.images.length} 张</span>
                              </div>
                              {job.status === "failed" && getImageJobErrorMessage(job) ? (
                                <div className="mt-2 line-clamp-2 text-xs text-destructive">
                                  {getImageJobErrorMessage(job)}
                                </div>
                              ) : null}
                            </button>
                          );
                        })}
                        {!isHistoryLoading && jobs.length === 0 ? (
                          <div className="px-6 py-8 text-sm text-muted-foreground">
                            还没有图片生成记录。
                          </div>
                        ) : null}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="lg:min-h-[42rem]">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">详情与预览</CardTitle>
                        <CardDescription>
                          {selectedJob
                            ? `任务 ${selectedJob.id}`
                            : "选择左侧任务查看图片与错误详情。"}
                        </CardDescription>
                      </div>
                      {selectedJob ? (
                        <Badge variant={statusVariant(selectedJob.status)}>
                          {statusLabel(selectedJob.status)}
                        </Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedJob ? (
                      <>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="flex flex-wrap gap-2">
                            {selectedJob.model ? (
                              <Badge variant="outline">{selectedJob.model}</Badge>
                            ) : null}
                            {getRequestText(selectedJob.request_params, "size") ? (
                              <Badge variant="outline">
                                {getRequestText(selectedJob.request_params, "size")}
                              </Badge>
                            ) : null}
                            {getRequestText(selectedJob.request_params, "aspect_ratio") ? (
                              <Badge variant="outline">
                                {getRequestText(selectedJob.request_params, "aspect_ratio")}
                              </Badge>
                            ) : null}
                            {getRequestText(selectedJob.request_params, "quality") ? (
                              <Badge variant="outline">
                                {getRequestText(selectedJob.request_params, "quality")}
                              </Badge>
                            ) : null}
                            {getRequestText(selectedJob.request_params, "n") ? (
                              <Badge variant="outline">
                                n={getRequestText(selectedJob.request_params, "n")}
                              </Badge>
                            ) : null}
                            {formatElapsed(selectedJob.elapsed_seconds) ? (
                              <Badge variant="secondary">
                                用时 {formatElapsed(selectedJob.elapsed_seconds)}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 whitespace-pre-wrap break-words text-sm">
                            {selectedJob.prompt || "该任务未返回 prompt。"}
                          </div>
                          <div className="mt-3 text-xs text-muted-foreground">
                            创建于 {formatJobTime(selectedJob.created_at)}
                            {selectedJob.updated_at
                              ? `，最近更新 ${formatJobTime(selectedJob.updated_at)}`
                              : ""}
                          </div>
                        </div>

                        {selectedJob.status === "failed" && getImageJobErrorMessage(selectedJob) ? (
                          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                            <span>{getImageJobErrorMessage(selectedJob)}</span>
                          </div>
                        ) : null}

                        {selectedJob.status === "completed" &&
                        selectedJob.images.length > 0 ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle2Icon className="size-4 text-emerald-600" />
                            已返回 {selectedJob.images.length} 张图片。
                          </div>
                        ) : null}

                        {isActiveImageJobStatus(selectedJob.status) ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <LoaderCircleIcon className="size-4 animate-spin" />
                            任务仍在进行中，页面会自动刷新状态。
                          </div>
                        ) : null}

                        {selectedJob.images.length > 0 ? (
                          <div className="grid gap-4 xl:grid-cols-2">
                            {selectedJob.images.map((image, index) => (
                              <div
                                key={`${selectedJob.id}-${image.id ?? index}-${image.download_url}`}
                                className="overflow-hidden rounded-xl border"
                              >
                                <div className="bg-muted/30">
                                  <img
                                    src={image.url}
                                    alt={`生成图片 ${index + 1}`}
                                    className="aspect-square w-full object-cover"
                                    loading="lazy"
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3 border-t p-3">
                                  <div className="min-w-0 text-xs text-muted-foreground">
                                    <div className="truncate">
                                      {image.id ?? `image-${index + 1}`}
                                    </div>
                                    <div className="truncate">
                                      {image.content_type ?? "未知格式"}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" asChild>
                                      <a
                                        href={image.download_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        download
                                      >
                                        <DownloadIcon className="size-3.5" />
                                        下载
                                      </a>
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      type="button"
                                      onClick={() => void handleCopyUrl(image.download_url)}
                                    >
                                      <CopyIcon className="size-3.5" />
                                      复制 URL
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                            {selectedJob.status === "failed"
                              ? "该任务没有可预览图片。"
                              : "图片尚未返回，等待后端生成或刷新历史后再查看。"}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                        暂无任务可展示。
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </ScrollArea>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
