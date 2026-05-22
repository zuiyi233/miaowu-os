import { formatDistanceToNow } from "date-fns";
import { enUS as dateFnsEnUS, zhCN as dateFnsZhCN } from "date-fns/locale";

import { detectLocale, type Locale } from "@/core/i18n";
import { getLocaleFromCookie } from "@/core/i18n/cookies";

function getDateFnsLocale(locale: Locale) {
  switch (locale) {
    case "zh-CN":
      return dateFnsZhCN;
    case "en-US":
    default:
      return dateFnsEnUS;
  }
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

function parseTimestamp(value: number) {
  if (!Number.isFinite(value)) {
    return null;
  }
  // Support both Unix seconds (e.g. 1776433710.8145406) and Unix milliseconds.
  const milliseconds = Math.abs(value) < 1e11 ? value * 1000 : value;
  const parsed = new Date(milliseconds);
  return isValidDate(parsed) ? parsed : null;
}

export function parseDateInput(
  input: Date | string | number | null | undefined,
): Date | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (input instanceof Date) {
    return isValidDate(input) ? input : null;
  }

  if (typeof input === "number") {
    return parseTimestamp(input);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const maybeNumeric = Number(trimmed);
  if (Number.isFinite(maybeNumeric) && /^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return parseTimestamp(maybeNumeric);
  }

  const parsed = new Date(trimmed);
  return isValidDate(parsed) ? parsed : null;
}

export function formatTimeAgo(
  date: Date | string | number | null | undefined,
  locale?: Locale,
) {
  const effectiveLocale =
    locale ??
    (getLocaleFromCookie() as Locale | null) ??
    // Fallback when cookie is missing (or on first render)
    detectLocale();

  const parsedDate = parseDateInput(date);
  if (!parsedDate) {
    return "";
  }

  return formatDistanceToNow(parsedDate, {
    addSuffix: true,
    locale: getDateFnsLocale(effectiveLocale),
  });
}

export function formatLocalDateTime(
  date: Date | string | number | null | undefined,
): string {
  const parsedDate = parseDateInput(date);
  if (!parsedDate) {
    return "";
  }
  return parsedDate.toLocaleString();
}
