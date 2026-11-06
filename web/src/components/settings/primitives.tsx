"use client";

import { useSettingsT as useT } from "@/components/settings/use-settings-t";

/**
 * Shared building blocks for the Settings tabs, so every panel states its
 * scope, reports errors and filters lists the same way.
 */

import type { ReactNode } from "react";
import { AlertCircleIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** When a change takes effect — shown under every panel heading. */
export type AppliesTo = "new-chats" | "immediately" | "live-chats";

const APPLIES_TEXT: Record<AppliesTo, string> = {
  "new-chats": "Changes apply to new chat tabs; open chats keep what they started with.",
  immediately: "Changes apply immediately — no restart needed.",
  "live-chats": "Changes apply immediately, including in open chats.",
};

export function SettingsHeader({
  title,
  description,
  appliesTo,
  actions,
}: {
  title: string;
  description?: ReactNode;
  appliesTo?: AppliesTo;
  actions?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{typeof title === "string" ? t(title) : title}</h3>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{typeof description === "string" ? t(description) : description}</p>
        ) : null}
        {appliesTo ? (
          <p className="mt-1 text-[11px] text-muted-foreground/80">{t(APPLIES_TEXT[appliesTo])}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SettingsError({ children, className }: { children: ReactNode; className?: string }) {
  const t = useT();
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      <AlertCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{typeof children === "string" ? t(children) : children}</span>
    </div>
  );
}

export function SettingsNotice({ children, className }: { children: ReactNode; className?: string }) {
  const t = useT();
  if (!children) return null;
  return (
    <div role="status" className={cn("rounded-lg border bg-muted/40 px-3 py-2 text-xs", className)}>
      {typeof children === "string" ? t(children) : children}
    </div>
  );
}

/** A bordered card with a legend — the unit each independently-saved group uses. */
export function SettingsCard({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <fieldset id={id} className={cn("scroll-mt-4 rounded-xl border p-3.5", className)}>
      <legend className="px-1 text-xs font-medium">{typeof title === "string" ? t(title) : title}</legend>
      {description ? (
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{typeof description === "string" ? t(description) : description}</p>
      ) : null}
      {children}
    </fieldset>
  );
}

export type SettingsScope = "project" | "global";

/**
 * Project vs all-projects toggle. Buttons with aria-pressed rather than a
 * tablist: there is no tabpanel, the list below simply reloads.
 */
export function ScopeSwitcher({
  value,
  onChange,
  projectName,
  disabled,
}: {
  value: SettingsScope;
  onChange: (scope: SettingsScope) => void;
  projectName: string;
  disabled?: boolean;
}) {
  const t = useT();
  const options: { value: SettingsScope; label: string }[] = [
    { value: "project", label: t("This project ({v0})", { v0: projectName }) },
    { value: "global", label: "All projects" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border p-1 text-xs" role="group" aria-label={t("Scope")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => {
            if (value !== option.value) onChange(option.value);
          }}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 transition-colors",
            value === option.value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}

/** Case-insensitive match of a query against any of the given fields. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(q));
}

export function SettingsSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("relative", className)}>
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholder)}
        aria-label={t(label)}
        className="h-8 pl-8 text-xs"
      />
    </div>
  );
}
