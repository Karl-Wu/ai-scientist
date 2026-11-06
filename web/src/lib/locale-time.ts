import type { Locale } from "./i18n";
import { translate } from "./translations";

export function relativeTime(value: string | number, locale: Locale, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return translate(locale, "just now");
  if (minutes < 60) return translate(locale, "{count}m ago", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return translate(locale, "{count}h ago", { count: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return translate(locale, "{count}d ago", { count: days });
  return new Date(timestamp).toLocaleDateString(locale);
}
