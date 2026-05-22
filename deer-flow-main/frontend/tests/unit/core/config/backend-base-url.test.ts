import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ORIGINAL_BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
const ORIGINAL_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD;

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551";
  delete process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD;

  vi.stubGlobal("window", {
    location: {
      origin: "http://localhost:4560",
      hostname: "localhost",
      pathname: "/login",
    },
  } as typeof window);
});

afterEach(() => {
  vi.unstubAllGlobals();

  if (ORIGINAL_BACKEND_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL = ORIGINAL_BACKEND_BASE_URL;
  }

  if (ORIGINAL_DESKTOP_BUILD === undefined) {
    delete process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD;
  } else {
    process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD = ORIGINAL_DESKTOP_BUILD;
  }
});

it("normalizes loopback backend URLs to the current browser host while preserving the 8551 port", async () => {
  const { getBackendBaseURL } = await import("@/core/config");
  const { resolveApiUrl } = await import("@/core/api/fetcher");

  expect(getBackendBaseURL()).toBe("http://localhost:8551");
  expect(resolveApiUrl("/api/v1/auth/me")).toBe(
    "http://localhost:8551/api/v1/auth/me",
  );
});

it("keeps IPv6 loopback hosts normalized when the browser origin uses [::1]", async () => {
  vi.unstubAllGlobals();
  vi.stubGlobal("window", {
    location: {
      origin: "http://[::1]:4560",
      hostname: "[::1]",
      pathname: "/login",
    },
  } as typeof window);

  const { getBackendBaseURL } = await import("@/core/config");

  expect(getBackendBaseURL()).toBe("http://[::1]:8551");
});
