import { describe, expect, it } from "vitest";
import zhCN from "@/data/locales/zh-CN.json";
import { translate } from "./translations";
import { relativeTime } from "./locale-time";

describe("translation catalog", () => {
  it("falls back to source messages and interpolates values literally", () => {
    expect(translate("zh-CN", "Untranslated UI {name}", { name: "研究" })).toBe("Untranslated UI 研究");
    expect(translate("en", "Delete “{name}”?", { name: "$& <script>" })).toBe("Delete “$& <script>”?");
    expect(translate("zh-CN", "Delete “{name}”?", { name: "Method.csv" })).toBe("删除“Method.csv”？");
  });
  it("preserves every interpolation parameter in Chinese", () => {
    const params = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
    for (const [source, translation] of Object.entries(zhCN)) {
      expect(translation.trim(), source).not.toBe("");
      expect(params(translation), source).toEqual(params(source));
    }
  });
  it("formats relative time in the UI locale", () => {
    const now = Date.UTC(2026, 10, 6, 12);
    expect(relativeTime(now - 180_000, "zh-CN", now)).toBe("3 分钟前");
    expect(relativeTime(now - 180_000, "en", now)).toBe("3m ago");
    expect(relativeTime("invalid", "zh-CN", now)).toBe("");
  });
});
