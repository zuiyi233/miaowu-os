import { afterEach, expect, test, vi } from "vitest";

const ORIGINAL_LANGGRAPH_BASE_URL = process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;

const ORIGINAL_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD;

afterEach(() => {
  vi.unstubAllGlobals();

  if (ORIGINAL_DESKTOP_BUILD === undefined) {
    delete process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD;
  } else {
    process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD = ORIGINAL_DESKTOP_BUILD;
  }

  if (ORIGINAL_LANGGRAPH_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL = ORIGINAL_LANGGRAPH_BASE_URL;
  }
});

test("getAPIClient injects credentials include into LangGraph fetches", async () => {
  vi.resetModules();
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  vi.stubGlobal("fetch", fetchSpy);

  const { getAPIClient } = await import("@/core/api/api-client");

  await getAPIClient().threads.search({ limit: 1 });

  expect(fetchSpy).toHaveBeenCalled();
  const [, init] = fetchSpy.mock.calls[0]!;
  expect(init?.credentials).toBe("include");
});

test("getAPIClient normalizes loopback langgraph base URLs to the browser host", async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL = "http://127.0.0.1:8551/api";
  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/workspace",
    },
  } as typeof window);

  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  vi.stubGlobal("fetch", fetchSpy);

  const { getAPIClient } = await import("@/core/api/api-client");

  await getAPIClient().threads.search({ limit: 1 });

  expect(fetchSpy).toHaveBeenCalled();
  const [input, init] = fetchSpy.mock.calls[0]!;
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  expect(requestUrl).toContain("http://localhost:8551/api");
  expect(init?.credentials).toBe("include");
});
