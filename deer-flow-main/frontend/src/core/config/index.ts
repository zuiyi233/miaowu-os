import { env } from "@/env";

const isDesktopBuild = process.env.NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD === "1";

function getBaseOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  // Fallback for SSR
  return "http://localhost:2026";
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
    return new URL(
      env.NEXT_PUBLIC_LANGGRAPH_BASE_URL,
      getBaseOrigin(),
    ).toString();
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
