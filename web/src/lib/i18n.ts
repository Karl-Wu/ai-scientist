export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "kady:locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function localeFromLanguage(language: string | null | undefined): Locale {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
