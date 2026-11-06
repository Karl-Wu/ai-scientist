import zhCN from "@/data/locales/zh-CN.json";
import type { Locale, TranslationParams } from "./i18n";

export type Translate = (message: string, params?: TranslationParams) => string;
const chinese: Readonly<Record<string, string>> = zhCN;

export function translate(locale: Locale, message: string, params?: TranslationParams): string {
  const template = locale === "zh-CN" ? chinese[message] ?? message : message;
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    params?.[name] === undefined ? token : String(params[name]),
  );
}

export const english: Translate = (message, params) => translate("en", message, params);
