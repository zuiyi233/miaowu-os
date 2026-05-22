/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

function getInternalServiceURL(envKey, fallbackURL) {
  const configured = process.env[envKey]?.trim();
  return configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : fallbackURL;
}
import nextra from "nextra";

const withNextra = nextra({});
const isDesktopBuild = process.env.DEERFLOW_DESKTOP_BUILD === "1";
const forceDesktopProxy = isDesktopBuild || process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD === "1";

/** @type {import("next").NextConfig} */
const config = {
  i18n: {
    locales: ["en", "zh"],
    defaultLocale: "en",
  },
  devIndicators: false,
  ...(isDesktopBuild ? { output: "standalone" } : {}),
  async rewrites() {
    const rewrites = [];
    const gatewayURL = getInternalServiceURL(
      "DEER_FLOW_INTERNAL_GATEWAY_BASE_URL",
      "http://127.0.0.1:8551",
    );

    if (forceDesktopProxy || !process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
      rewrites.push({
        source: "/api/langgraph",
        destination: `${gatewayURL}/api`,
      });
      rewrites.push({
        source: "/api/langgraph/:path*",
        destination: `${gatewayURL}/api/:path*`,
      });
    }

    if (forceDesktopProxy || !process.env.NEXT_PUBLIC_BACKEND_BASE_URL) {
      rewrites.push({
        source: "/api/agents",
        destination: `${gatewayURL}/api/agents`,
      });
      rewrites.push({
        source: "/api/agents/:path*",
        destination: `${gatewayURL}/api/agents/:path*`,
      });
      rewrites.push({
        source: "/api/skills",
        destination: `${gatewayURL}/api/skills`,
      });
      rewrites.push({
        source: "/api/skills/:path*",
        destination: `${gatewayURL}/api/skills/:path*`,
      });

      // Catch-all for remaining gateway API routes (models, threads, memory,
      // mcp, artifacts, uploads, suggestions, runs, etc.) that don't have
      // their own NEXT_PUBLIC_* env var toggle.
      //
      // NOTE: this must come AFTER the /api/langgraph rewrite above so that
      // LangGraph routes are matched first when NEXT_PUBLIC_LANGGRAPH_BASE_URL
      // is unset.
      rewrites.push({
        source: "/api/:path*",
        destination: `${gatewayURL}/api/:path*`,
      });

      // Novel export endpoint is served under `/projects/*` on gateway.
      // Keep this rewrite so default frontend proxy mode can download archives.
      rewrites.push({
        source: "/projects/:path*",
        destination: `${gatewayURL}/projects/:path*`,
      });
      rewrites.push({
        source: "/book-import/:path*",
        destination: `${gatewayURL}/book-import/:path*`,
      });
    }

    return rewrites;
  },
};

export default withNextra(config);
