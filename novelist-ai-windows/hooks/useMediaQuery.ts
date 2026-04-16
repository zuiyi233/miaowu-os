import { useState, useEffect } from "react";

/**
 * 响应式媒体查询 Hook
 * 遵循单一职责原则，专注于媒体查询状态管理
 * @param query - CSS 媒体查询字符串
 * @returns 媒体查询是否匹配
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [matches, query]);

  return matches;
}