import { env } from "@/env";

const isDesktopBuild = process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD === "1";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function formatHostnameForURL(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
}

function getBaseOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  // Fallback for SSR
  return "http://localhost:2026";
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

/**
 * Align client-side API requests with the browser's loopback host.
 *
 * Browser cookies are host-scoped. If the frontend runs on `localhost`
 * but the API base URL is `127.0.0.1` (or vice versa), authenticated
 * requests may miss the session cookie even when the port is identical.
 */
function normalizeLoopbackBaseURL(baseURL: string): string {
  if (typeof window === "undefined") {
    return baseURL;
  }

  const currentHostname = normalizeHostname(window.location.hostname);
  if (!isLoopbackHostname(currentHostname)) {
    return baseURL;
  }

  try {
    const url = new URL(baseURL);
    const backendHostname = normalizeHostname(url.hostname);
    if (
      !isLoopbackHostname(backendHostname) ||
      backendHostname === currentHostname
    ) {
      return baseURL;
    }

    url.hostname = formatHostnameForURL(currentHostname);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseURL;
  }
}

let _cachedBackendBaseURL: string | undefined;

export function getBackendBaseURL() {
  if (_cachedBackendBaseURL !== undefined) {
    return _cachedBackendBaseURL;
  }
  let result: string;
  if (isDesktopBuild) {
    result = "";
  } else if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    result = new URL(env.NEXT_PUBLIC_BACKEND_BASE_URL, getBaseOrigin())
      .toString()
      .replace(/\/+$/, "");
    result = normalizeLoopbackBaseURL(result);
  } else {
    result = "";
  }
  _cachedBackendBaseURL = result;
  return result;
}

export function resetBackendBaseURLCache() {
  _cachedBackendBaseURL = undefined;
}

export function getLangGraphBaseURL(isMock?: boolean) {
  if (isDesktopBuild && !isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/langgraph`;
    }
    return "http://localhost:2026/api/langgraph";
  }

  if (env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
    const result = new URL(
      env.NEXT_PUBLIC_LANGGRAPH_BASE_URL,
      getBaseOrigin(),
    ).toString();
    return normalizeLoopbackBaseURL(result);
  } else if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:3000/mock/api";
  } else {
    // LangGraph SDK requires a full URL, construct it from current origin
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/langgraph`;
    }
    // Fallback for SSR
    return "http://localhost:2026/api/langgraph";
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
