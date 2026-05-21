"use client";

import { NovelRouteError } from "@/components/novel/routes/NovelRouteError";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <NovelRouteError error={error} reset={reset} />;
}
