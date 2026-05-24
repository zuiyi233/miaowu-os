import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithAuth = vi.fn();

vi.mock("@/core/api/fetcher", () => ({
  fetch: fetchWithAuth,
}));

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://127.0.0.1:8551",
}));

beforeEach(() => {
  fetchWithAuth.mockReset();
});

describe("images api contract", () => {
  it("normalizes relative image file urls to the Miaowu gateway", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "job-1",
        status: "completed",
        prompt: "cat",
        request_params: {
          size: "1024x1024",
          quality: "high",
          n: 1,
        },
        images: [
          {
            image_id: "img-1",
          },
          {
            id: "img-2",
            download_url: "/api/v1/images/files/img-2",
            content_type: "image/png",
          },
        ],
      }),
    });

    const { generateImage } = await import("@/core/images/api");

    const result = await generateImage({
      prompt: "cat",
      size: "1024x1024",
      quality: "high",
      n: 1,
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "http://127.0.0.1:8551/api/v1/images/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [, init] = fetchWithAuth.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      prompt: "cat",
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    expect(result.images).toEqual([
      {
        id: "img-1",
        url: "http://127.0.0.1:8551/api/v1/images/files/img-1",
        download_url: "http://127.0.0.1:8551/api/v1/images/files/img-1",
        content_type: null,
      },
      {
        id: "img-2",
        url: "http://127.0.0.1:8551/api/v1/images/files/img-2",
        download_url: "http://127.0.0.1:8551/api/v1/images/files/img-2",
        content_type: "image/png",
      },
    ]);
  });

  it("passes aspect_ratio through the 8551 gateway contract", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "job-2",
        status: "completed",
        prompt: "poster",
        request_params: {
          aspect_ratio: "16:9",
          n: 1,
        },
        images: [],
      }),
    });

    const { generateImage } = await import("@/core/images/api");

    await generateImage({
      prompt: "poster",
      aspect_ratio: "16:9",
      n: 1,
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "http://127.0.0.1:8551/api/v1/images/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [, init] = fetchWithAuth.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      prompt: "poster",
      aspect_ratio: "16:9",
      n: 1,
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("size");
  });

  it("preserves structured backend error messages for UI display", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: {
          code: "invalid_request",
          message: "Prompt is required",
        },
      }),
    });

    const { generateImage, ImagesApiError } = await import("@/core/images/api");

    const promise = generateImage({ prompt: "" });

    await expect(promise).rejects.toMatchObject({
      name: "ImagesApiError",
      code: "invalid_request",
      status: 422,
      message: "Prompt is required",
    });
    await expect(promise).rejects.toBeInstanceOf(ImagesApiError);
  });
});
