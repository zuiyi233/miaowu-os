import { afterEach, expect, test } from "vitest";

import nextConfig from "../../../../next.config.js";

const ORIGINAL_BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;

afterEach(() => {
  if (ORIGINAL_BACKEND_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL = ORIGINAL_BACKEND_BASE_URL;
  }
});

test("default proxy mode exposes /projects rewrite to gateway", async () => {
  delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;

  const rewrites = (await nextConfig.rewrites?.()) as Array<{
    source: string;
    destination?: string;
  }>;
  const hasProjectsRewrite = rewrites.some(
    (item) =>
      item.source === "/projects/:path*" &&
      typeof item.destination === "string" &&
      item.destination.endsWith("/projects/:path*"),
  );

  expect(hasProjectsRewrite).toBe(true);
});

test("default proxy mode targets the 8551 gateway port", async () => {
  delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;

  const rewrites = (await nextConfig.rewrites?.()) as Array<{
    source: string;
    destination?: string;
  }>;
  const gatewayRewrite = rewrites.find(
    (item) =>
      item.source === "/api/agents" &&
      typeof item.destination === "string",
  );

  expect(gatewayRewrite?.destination).toBe("http://127.0.0.1:8551/api/agents");
});

test("default proxy mode respects the internal gateway base url override", async () => {
  delete process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
  process.env.DEER_FLOW_INTERNAL_GATEWAY_BASE_URL = "http://127.0.0.1:9123";

  const rewrites = (await nextConfig.rewrites?.()) as Array<{
    source: string;
    destination?: string;
  }>;
  const gatewayRewrite = rewrites.find(
    (item) =>
      item.source === "/api/agents" &&
      typeof item.destination === "string",
  );

  expect(gatewayRewrite?.destination).toBe("http://127.0.0.1:9123/api/agents");

  delete process.env.DEER_FLOW_INTERNAL_GATEWAY_BASE_URL;
});
