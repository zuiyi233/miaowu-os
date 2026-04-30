export type QueryValue = string | number | boolean | null | undefined;

export function buildUrlWithPrefix(
  prefix: string,
  path: string,
  query?: Record<string, QueryValue>,
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = `${prefix}${normalizedPath}`;

  if (!query) {
    return base;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

export function parseJsonOrText(responseText: string): unknown {
  if (!responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export function mergeAbortSignals(
  signals: ReadonlyArray<AbortSignal | null | undefined>,
): AbortSignal | undefined {
  const validSignals = signals.filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );
  if (validSignals.length === 0) return undefined;
  if (validSignals.length === 1) return validSignals[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(validSignals);
  }

  const fallbackController = new AbortController();
  const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];
  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener("abort", handler);
    }
    listeners.length = 0;
  };
  const onAbort = () => {
    cleanup();
    fallbackController.abort();
  };

  for (const signal of validSignals) {
    if (signal.aborted) {
      onAbort();
      break;
    }

    const handler = () => onAbort();
    listeners.push({ signal, handler });
    signal.addEventListener("abort", handler, { once: true });
  }

  fallbackController.signal.addEventListener("abort", cleanup, { once: true });
  return fallbackController.signal;
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const signal = mergeAbortSignals([controller.signal, options.signal]);
    const response = await fetch(url, { ...options, signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
