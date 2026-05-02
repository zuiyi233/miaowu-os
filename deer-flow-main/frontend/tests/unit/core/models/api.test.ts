import { afterEach, expect, test, vi } from "vitest";

const ORIGINAL_BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;

afterEach(() => {
  vi.unstubAllGlobals();

  if (ORIGINAL_BACKEND_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL = ORIGINAL_BACKEND_BASE_URL;
  }
});

test("loadModels sends credentials when calling the backend directly", async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551";
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  vi.stubGlobal("fetch", fetchSpy);

  const { loadModels } = await import("@/core/models/api");

  await loadModels();

  expect(fetchSpy).toHaveBeenCalledWith(
    "http://localhost:8551/api/models",
    expect.objectContaining({
      credentials: "include",
    }),
  );
});
