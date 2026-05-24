import { fetch as authFetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type {
  ImageGenerateRequest,
  ImageJob,
  ImageJobImage,
  ImageJobStatus,
} from "./types";

const IMAGES_API_PREFIX = "/api/v1/images";

function imagesApiUrl(path: string): string {
  return `${getBackendBaseURL()}${IMAGES_API_PREFIX}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBackendUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${getBackendBaseURL()}${url}`;
  return url;
}

function imageFileUrl(imageId: string): string {
  return imagesApiUrl(`/files/${encodeURIComponent(imageId)}`);
}

function normalizeStatus(value: unknown): ImageJobStatus {
  const status = readString(value)?.toLowerCase();
  switch (status) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

function extractErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  if (!isRecord(error)) {
    return null;
  }

  const detail = error.detail;
  return (
    readString(error.message) ??
    readString(error.error) ??
    readString(error.detail) ??
    (isRecord(detail)
      ? readString(detail.message) ??
        readString(detail.error) ??
        readString(detail.detail)
      : readString(detail))
  );
}

function normalizeImage(
  value: unknown,
  index: number,
): ImageJobImage | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = toBackendUrl(value.trim());
    if (!normalized) return null;
    return {
      id: null,
      url: normalized,
      download_url: normalized,
      content_type: null,
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const imageId =
    readString(value.image_id) ??
    readString(value.id) ??
    readString(value.file_id);
  const directUrl =
    readString(value.url) ??
    readString(value.download_url) ??
    readString(value.file_url) ??
    readString(value.public_url) ??
    readString(value.source_origin_url);
  const url = toBackendUrl(directUrl) ?? (imageId ? imageFileUrl(imageId) : null);
  if (!url) return null;

  return {
    id: imageId ?? `image-${index + 1}`,
    url,
    download_url:
      toBackendUrl(readString(value.download_url)) ??
      toBackendUrl(readString(value.file_url)) ??
      url,
    content_type: readString(value.content_type),
  };
}

function extractImages(
  job: Record<string, unknown>,
  responseMetadata: Record<string, unknown>,
): ImageJobImage[] {
  const sources = [
    job.images,
    job.image_urls,
    job.files,
    responseMetadata.images,
    responseMetadata.image_urls,
  ];

  const normalized = sources
    .filter(Array.isArray)
    .flatMap((items) =>
      items
        .map((item, index) => normalizeImage(item, index))
        .filter((item): item is ImageJobImage => item !== null),
    );

  const deduped = new Map<string, ImageJobImage>();
  for (const image of normalized) {
    deduped.set(`${image.id ?? ""}|${image.download_url}`, image);
  }
  return [...deduped.values()];
}

function normalizeJob(value: unknown, index: number): ImageJob {
  const record = isRecord(value) ? value : {};
  const requestParams = isRecord(record.request_params)
    ? record.request_params
    : isRecord(record.parameters)
      ? record.parameters
      : {};
  const responseMetadata = isRecord(record.response_metadata)
    ? record.response_metadata
    : isRecord(record.metadata)
      ? record.metadata
      : {};
  const prompt =
    readString(record.prompt) ?? readString(requestParams.prompt) ?? "";
  const model =
    readString(record.model) ??
    readString(requestParams.model) ??
    readString(responseMetadata.model);
  const id =
    readString(record.id) ??
    readString(record.job_id) ??
    `image-job-${index + 1}`;

  return {
    id,
    status: normalizeStatus(record.status),
    operation: readString(record.operation),
    prompt,
    model,
    request_params: requestParams,
    response_metadata: responseMetadata,
    images: extractImages(record, responseMetadata),
    error: record.error ?? record.detail ?? null,
    error_message: extractErrorMessage(record.error ?? record.detail ?? null),
    elapsed_seconds: readNumber(record.elapsed_seconds),
    created_at: readString(record.created_at),
    updated_at: readString(record.updated_at),
  };
}

function extractJobs(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.jobs)) {
    return payload.jobs;
  }
  return [];
}

function extractApiErrorCode(body: unknown, status: number): string {
  if (!isRecord(body)) {
    return `http_${status}`;
  }
  const detail = body.detail;
  return (
    readString(body.code) ??
    readString(body.error_code) ??
    (isRecord(detail)
      ? readString(detail.code) ?? readString(detail.error_code)
      : null) ??
    `http_${status}`
  );
}

function extractApiErrorMessage(body: unknown, status: number): string {
  const fallback = `Images request failed: ${status}`;
  if (!isRecord(body)) {
    return fallback;
  }

  const detail = body.detail;
  return (
    readString(body.message) ??
    readString(body.error) ??
    (isRecord(detail)
      ? readString(detail.message) ??
        readString(detail.error) ??
        readString(detail.detail)
      : readString(detail)) ??
    fallback
  );
}

export class ImagesApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, code: string, status: number, detail: unknown) {
    super(message);
    this.name = "ImagesApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function readImagesApiError(res: Response): Promise<ImagesApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}

  return new ImagesApiError(
    extractApiErrorMessage(body, res.status),
    extractApiErrorCode(body, res.status),
    res.status,
    body,
  );
}

function buildGeneratePayload(request: ImageGenerateRequest) {
  return {
    prompt: request.prompt,
    model: request.model ?? undefined,
    size: request.size ?? undefined,
    aspect_ratio: request.aspect_ratio ?? undefined,
    quality: request.quality ?? undefined,
    n: request.n ?? undefined,
  };
}

export async function generateImage(
  request: ImageGenerateRequest,
): Promise<ImageJob> {
  const res = await authFetch(imagesApiUrl("/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGeneratePayload(request)),
  });
  if (!res.ok) {
    throw await readImagesApiError(res);
  }
  return normalizeJob(await res.json(), 0);
}

export async function listImageJobs(
  signal?: AbortSignal,
): Promise<ImageJob[]> {
  const res = await authFetch(imagesApiUrl("/jobs"), { signal });
  if (!res.ok) {
    throw await readImagesApiError(res);
  }
  return extractJobs(await res.json()).map(normalizeJob);
}

export async function getImageJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ImageJob> {
  const res = await authFetch(
    imagesApiUrl(`/jobs/${encodeURIComponent(jobId)}`),
    { signal },
  );
  if (!res.ok) {
    throw await readImagesApiError(res);
  }
  return normalizeJob(await res.json(), 0);
}

export function isActiveImageJobStatus(status: ImageJobStatus): boolean {
  return status === "queued" || status === "running";
}

export function getImageJobErrorMessage(job: ImageJob): string | null {
  return job.error_message ?? extractErrorMessage(job.error);
}
