import type { Translations } from "./types";

type ImagesTranslations = Translations["images"];
type ImagesLocale = "en" | "zh";

const zhLabels: Partial<Record<keyof ImagesTranslations, string>> = {
  pageTitle: "图片生成 - Miaowu OS",
  cardTitle: "图片生成",
  cardDescription: "通过网关提交文生图请求，历史记录从后端自动刷新。",
  sizeDefault: "后端默认",
  ratioUnspecified: "不指定",
  qualityDefault: "后端默认",
  statusQueued: "排队中",
  statusRunning: "生成中",
  statusCompleted: "已完成",
  statusFailed: "失败",
  statusUnknown: "未知",
  submit: "提交",
  submitting: "提交中",
  startGenerate: "开始生成",
  refresh: "刷新",
  download: "下载",
  copyUrl: "复制 URL",
  promptPlaceholder: "描述想生成的画面、镜头、材质、光线或构图。",
  modelPlaceholder: "例如 gpt-image-1",
  selectSize: "选择尺寸",
  selectRatio: "选择比例",
  selectQuality: "选择质量",
  sizeRatioMutualExclude: "`size` 与 `aspect_ratio` 互斥。选中一个后，另一个会回到默认值。",
  promptRequired: "Prompt 不能为空。",
  countInvalid: "数量 n 必须是 1 到 10 之间的整数。",
  loadHistoryFailed: "加载图片历史失败",
  submitFailed: "提交生成失败",
  jobSubmitted: "已提交图片生成任务",
  jobCompleted: "图片生成已返回结果",
  urlCopied: "图片 URL 已复制",
  copyUrlFailed: "复制 URL 失败",
  detailTitle: "详情与预览",
  noTaskSelected: "选择左侧任务查看图片与错误详情。",
  noRecords: "还没有图片生成记录。",
  noPreviewForFailed: "该任务没有可预览图片。",
  waitingForImages: "图片尚未返回，等待后端生成或刷新历史后再查看。",
  noTaskToDisplay: "暂无任务可展示。",
  noTimeRecorded: "未记录时间",
  currentStatus: "当前状态",
  requestSending: "请求发送中",
  idle: "空闲",
  history: "历史",
  historyDescription: "最新任务优先，生成后自动刷新。",
  useBackendDefault: "使用后端默认参数",
  unknownFormat: "未知格式",
  noPrompt: "该任务未返回 prompt。",
  createdAt: "创建于",
  updatedAt: "，最近更新 ",
};

const enLabels: Partial<Record<keyof ImagesTranslations, string>> = {
  pageTitle: "Image Generation - Miaowu OS",
  cardTitle: "Image Generation",
  cardDescription: "Submit text-to-image requests via gateway. History auto-refreshes from backend.",
  sizeDefault: "Backend Default",
  ratioUnspecified: "Unspecified",
  qualityDefault: "Backend Default",
  statusQueued: "Queued",
  statusRunning: "Generating",
  statusCompleted: "Completed",
  statusFailed: "Failed",
  statusUnknown: "Unknown",
  submit: "Submit",
  submitting: "Submitting",
  startGenerate: "Start Generate",
  refresh: "Refresh",
  download: "Download",
  copyUrl: "Copy URL",
  promptPlaceholder: "Describe the scene, camera angle, materials, lighting, or composition you want.",
  modelPlaceholder: "e.g. gpt-image-1",
  selectSize: "Select size",
  selectRatio: "Select ratio",
  selectQuality: "Select quality",
  sizeRatioMutualExclude: "`size` and `aspect_ratio` are mutually exclusive. Selecting one resets the other to default.",
  promptRequired: "Prompt is required.",
  countInvalid: "Count n must be an integer between 1 and 10.",
  loadHistoryFailed: "Failed to load image history",
  submitFailed: "Failed to submit generation",
  jobSubmitted: "Image generation task submitted",
  jobCompleted: "Image generation completed",
  urlCopied: "Image URL copied",
  copyUrlFailed: "Failed to copy URL",
  detailTitle: "Details & Preview",
  noTaskSelected: "Select a task on the left to view images and error details.",
  noRecords: "No image generation records yet.",
  noPreviewForFailed: "No preview available for this failed task.",
  waitingForImages: "Images not yet returned. Wait for backend generation or refresh history.",
  noTaskToDisplay: "No task to display.",
  noTimeRecorded: "No time recorded",
  currentStatus: "Current Status",
  requestSending: "Request sending",
  idle: "Idle",
  history: "History",
  historyDescription: "Latest tasks first, auto-refresh after generation.",
  useBackendDefault: "Using backend default parameters",
  unknownFormat: "Unknown format",
  noPrompt: "This task did not return a prompt.",
  createdAt: "Created at",
  updatedAt: ", updated ",
};

function labelFromKey(key: string, locale: ImagesLocale): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();

  if (!label) {
    return key;
  }

  return locale === "zh"
    ? label
    : label.charAt(0).toUpperCase() + label.slice(1);
}

function functionFallback(key: keyof ImagesTranslations, locale: ImagesLocale) {
  if (key === "jobCount") {
    return (count: number, hasActive: boolean) =>
      locale === "zh"
        ? `历史：${count} 个任务${hasActive ? "，含进行中" : ""}。`
        : `History: ${count} task${count !== 1 ? "s" : ""}${hasActive ? ", including active tasks." : "."}`;
  }

  if (key === "returnedCount") {
    return (count: number) =>
      locale === "zh"
        ? `已返回 ${count} 张图片。`
        : `${count} image${count !== 1 ? "s" : ""} returned.`;
  }

  if (key === "imageAlt") {
    return (index: number) =>
      locale === "zh"
        ? `生成的图片 ${index + 1}`
        : `Generated image ${index + 1}`;
  }

  if (key === "taskLabel") {
    return (id: string) =>
      locale === "zh" ? `任务 ${id}` : `Task ${id}`;
  }

  if (key === "elapsedTime") {
    return (seconds: number) => `${seconds}s`;
  }

  return undefined;
}

export function withImagesDefaults(
  translations: Partial<ImagesTranslations>,
  locale: ImagesLocale,
): ImagesTranslations {
  const labels = locale === "zh" ? zhLabels : enLabels;

  return new Proxy(translations as ImagesTranslations, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined || typeof property !== "string") {
        return value;
      }

      const key = property as keyof ImagesTranslations;
      return (
        functionFallback(key, locale) ??
        labels[key] ??
        labelFromKey(property, locale)
      );
    },
  });
}
