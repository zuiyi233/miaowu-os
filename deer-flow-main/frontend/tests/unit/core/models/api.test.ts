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

test("loadModels returns default_model_name and default_provider_id from backend", async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551";
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              id: "mimo-v2.5-pro",
              name: "mimo-v2.5-pro",
              model: "mimo-v2.5-pro",
              display_name: "MiMo V2.5 Pro",
              provider_id: "newapi-vip",
            },
          ],
          token_usage: { enabled: false },
          default_model_name: "mimo-v2.5-pro",
          default_provider_id: "newapi-vip",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );

  const { loadModels } = await import("@/core/models/api");
  const result = await loadModels();

  expect(result.default_model_name).toBe("mimo-v2.5-pro");
  expect(result.default_provider_id).toBe("newapi-vip");
  expect(result.models[0]?.provider_id).toBe("newapi-vip");
});

test("loadModels returns null defaults when backend omits them", async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551";
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              id: "some-model",
              name: "some-model",
              model: "some-model",
              display_name: "Some Model",
            },
          ],
          token_usage: { enabled: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );

  const { loadModels } = await import("@/core/models/api");
  const result = await loadModels();

  expect(result.default_model_name).toBeNull();
  expect(result.default_provider_id).toBeNull();
});

test("loadModels returns models with provider_id from each model entry", async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551";
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              id: "model-a",
              name: "model-a",
              model: "model-a",
              display_name: "Model A",
              provider_id: "provider-alpha",
            },
            {
              id: "model-b",
              name: "model-b",
              model: "model-b",
              display_name: "Model B",
              provider_id: "provider-beta",
            },
          ],
          token_usage: { enabled: false },
          default_model_name: "model-a",
          default_provider_id: "provider-alpha",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );

  const { loadModels } = await import("@/core/models/api");
  const result = await loadModels();

  expect(result.models).toHaveLength(2);
  expect(result.models[0]?.provider_id).toBe("provider-alpha");
  expect(result.models[1]?.provider_id).toBe("provider-beta");
});
