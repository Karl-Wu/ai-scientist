import { describe, expect, it } from "vitest";
import { resolveChatTitle, suggestedChatTitle } from "./chat-title";

describe("chat titles", () => {
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
