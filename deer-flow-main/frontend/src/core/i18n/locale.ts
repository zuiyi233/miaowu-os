export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocaleByLang(lang: string): Locale {
  const normalizedLang = lang.toLowerCase();
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.startsWith(normalizedLang)) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

export function getLangByLocale(locale: Locale): string {
  const parts = locale.split("-");
  if (parts.length > 0 && typeof parts[0] === "string") {
    return parts[0];
  }
  return locale;
}

export function normalizeLocale(locale: string | null | undefined): Locale {
  if (!locale) {
    return DEFAULT_LOCALE;
  }

  if (isLocale(locale)) {
    return locale;
  }

  if (locale.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }

  return DEFAULT_LOCALE;
}

// Default first-time visitors to Chinese. Manual language changes still persist
// through the locale cookie and are handled by the i18n provider.
export function detectLocale(): Locale {
  return DEFAULT_LOCALE;
}
