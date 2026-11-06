"use client";
import { useCallback } from "react";
import { useT } from "@/components/i18n-provider";
import { settingsCopy } from "@/lib/settings-copy";
import type { Translate } from "@/lib/translations";

export function useSettingsT(): Translate {
  const t = useT();
  return useCallback((message, params) => params ? t(message, params) : settingsCopy(t, message), [t]);
}
