export type ImageJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "unknown";

export interface ImageGenerateRequest {
  prompt: string;
  model?: string;
  size?: string;
  aspect_ratio?: string;
  quality?: string;
  n?: number;
}

export interface ImageJobImage {
  id: string | null;
  url: string;
  download_url: string;
  content_type: string | null;
}

export interface ImageJob {
  id: string;
  status: ImageJobStatus;
  operation: string | null;
  prompt: string;
  model: string | null;
  request_params: Record<string, unknown>;
  response_metadata: Record<string, unknown>;
  images: ImageJobImage[];
  error: unknown;
  error_message: string | null;
  elapsed_seconds: number | null;
  created_at: string | null;
  updated_at: string | null;
}
