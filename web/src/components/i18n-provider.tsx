"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isLocale, LOCALE_STORAGE_KEY, localeFromLanguage, type Locale } from "@/lib/i18n";

import { toast } from "sonner";
import { readSavedLocale, saveLocale } from "@/lib/ui-locale-settings";

import { english, translate, type Translate } from "@/lib/translations";

type I18nContextValue = {
  t: Translate;
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  const revision = useRef(0);
  const saves = useRef(Promise.resolve());
  const cacheLocale = useCallback((value: Locale) => {
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, value); } catch { /* Cache is optional. */ }
  }, []);
  const persistLocale = useCallback((value: Locale) => {
    // Serialize rapid selections so the last choice also wins on disk.
    saves.current = saves.current.then(() => saveLocale(value)).catch(() => {
      toast.error(translate(value, "Language changed locally, but could not be saved to the app. Please try again."));
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    const version = revision.current;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // Storage can be disabled; browser language remains a useful fallback.
    }
    setLocaleState(isLocale(stored) ? stored : localeFromLanguage(navigator.language));
    void readSavedLocale().then((saved) => {
      if (disposed || revision.current !== version) return;
      if (saved) {
        setLocaleState(saved);
        cacheLocale(saved);
      } else if (isLocale(stored)) {
        // Migrate an existing explicit browser preference once; never save an inferred language.
        persistLocale(stored);
      }
    }).catch(() => { /* Offline: keep the cached preference. */ });
    return () => { disposed = true; };
  }, [cacheLocale, persistLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    revision.current++;
    setLocaleState(nextLocale);
    cacheLocale(nextLocale);
    persistLocale(nextLocale);
  }, [cacheLocale, persistLocale]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        revision.current++;
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
