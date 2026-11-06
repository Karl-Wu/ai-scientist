"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isLocale, LOCALE_STORAGE_KEY, localeFromLanguage, type Locale } from "@/lib/i18n";

import { english, translate, type Translate } from "@/lib/translations";

type I18nContextValue = {
  t: Translate;
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Storage can be disabled; browser language remains a useful fallback.
    }
    setLocaleState(isLocale(stored) ? stored : localeFromLanguage(navigator.language));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Keep the in-memory preference for this page even without storage access.
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        setLocaleState(isLocale(event.newValue) ? event.newValue : localeFromLanguage(navigator.language));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const t: Translate = useCallback((message, params) => translate(locale, message, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

/** Standalone UI primitives default to English when rendered outside the app shell. */
export function useT(): Translate {
  return useContext(I18nContext)?.t ?? english;
}

export function useLocale(): Locale {
  return useContext(I18nContext)?.locale ?? "en";
}
