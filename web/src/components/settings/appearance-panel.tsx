"use client";

import { LanguageSelector } from "@/components/language-selector";
import { useT } from "@/components/i18n-provider";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsHeader } from "./primitives";

export function AppearancePanel() {
  const t = useT();
  const { theme, setTheme } = useTheme();

  const options: { value: string; label: string; icon: typeof SunIcon }[] = [
    { value: "light", label: t("Light"), icon: SunIcon },
    { value: "dark", label: t("Dark"), icon: MoonIcon },
    { value: "system", label: t("System"), icon: MonitorIcon },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SettingsHeader
        title={t("Appearance")}
        description={t("Choose how AI Scientist looks. System follows your operating system's theme. Saved in this browser.")}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <label htmlFor="interface-language" className="text-sm font-medium">{t("Language")}</label>
          <p className="text-xs text-muted-foreground">{t("Choose your interface language. Saved in this browser.")}</p>
        </div>
        <LanguageSelector id="interface-language" />
      </div>
      <h3 className="text-sm font-medium">{t("Theme")}</h3>
      <div className="flex gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <Button
              key={opt.value}
              variant={active ? "default" : "outline"}
              size="sm"
              aria-pressed={active}
              onClick={() => setTheme(opt.value)}
              className={cn("flex-1 gap-1.5 text-xs")}
            >
              <Icon className="size-3.5" />
              {opt.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
