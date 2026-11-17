import { describe, expect, it } from "vitest";
import { resolveChatTitle, suggestedChatTitle, taskDisplayTitle } from "./chat-title";
import { translate } from "./translations";

describe("chat titles", () => {
  it("displays legacy placeholders as tasks while preserving user-chosen names", () => {
    const chinese = (message: string, params?: Record<string, string | number>) => translate("zh-CN", message, params);
    expect(taskDisplayTitle("Chat 2", false, chinese)).toBe("任务 2");
    expect(taskDisplayTitle("Chat 2", true, chinese)).toBe("Chat 2");
    expect(taskDisplayTitle("我的研究", false, chinese)).toBe("我的研究");
  });
  it("derives a compact title from the first user message", () => {
    expect(suggestedChatTitle("不同国家的疫情曲线\n 有何异同")).toBe("不同国家的疫情曲线 有何异同");
    expect(suggestedChatTitle("  ")).toBeUndefined();
    expect(suggestedChatTitle("a".repeat(80))).toHaveLength(61);
  });
  it("replaces placeholders but preserves meaningful or manually renamed titles", () => {
    expect(resolveChatTitle("Chat 1", "疫情曲线比较")).toBe("疫情曲线比较");
    expect(resolveChatTitle("我的研究", "疫情曲线比较")).toBe("我的研究");
    expect(resolveChatTitle("Chat 1", "疫情曲线比较", true)).toBe("Chat 1");
    expect(resolveChatTitle("Chat 1")).toBe("Chat 1");
  });
});
