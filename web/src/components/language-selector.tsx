"use client";

import { ChevronDownIcon } from "lucide-react";
import { useI18n, useT } from "./i18n-provider";
import { isLocale } from "@/lib/i18n";

export function LanguageSelector({ id }: { id?: string }) {
  const { locale, setLocale } = useI18n();
  const t = useT();
  return (
    <div className="relative shrink-0">
      <select
        id={id}
        aria-label={t("Language")}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
        className="h-9 appearance-none rounded-lg border bg-background pl-3 pr-8 text-xs text-muted-foreground outline-none focus:border-primary"
      >
        <option value="en" lang="en">English</option>
        <option value="zh-CN" lang="zh-CN">简体中文</option>
      </select>
      <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
