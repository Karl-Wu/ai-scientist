import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useT } from "./i18n-provider";
import { LanguageSelector } from "./language-selector";
import { ConnectModelCard } from "./connect-model-card";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";

function Sample() {
  const t = useT();
  return <><LanguageSelector /><ConnectModelCard /><p>{t("{count} entries", { count: 3 })}</p><p data-testid="user-content">Method / my_file.csv</p></>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
});
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); document.documentElement.lang = "en"; });

describe("UI language preference", () => {
  it("switches live UI, persists the choice, restores it after remount, and preserves user content", async () => {
    const first = render(<I18nProvider><Sample /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Connect a model to get started" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zh-CN" } });
    expect(screen.getByRole("heading", { name: "连接模型以开始使用" })).toBeInTheDocument();
    expect(screen.getByText("3 条记录")).toBeInTheDocument();
    expect(screen.getByTestId("user-content")).toHaveTextContent("Method / my_file.csv");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    first.unmount();
    render(<I18nProvider><Sample /></I18nProvider>);
    expect(await screen.findByRole("heading", { name: "连接模型以开始使用" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    expect(screen.getByRole("heading", { name: "Connect a model to get started" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("uses browser Chinese only when there is no valid saved preference", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-TW");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "invalid");
    const view = render(<I18nProvider><Sample /></I18nProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("zh-CN");
    view.unmount();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    render(<I18nProvider><Sample /></I18nProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("en");
  });

  it("syncs another browser tab's preference and still switches when storage is unavailable", async () => {
    render(<I18nProvider><Sample /></I18nProvider>);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: LOCALE_STORAGE_KEY, newValue: "zh-CN" })));
    expect(screen.getByRole("heading", { name: "连接模型以开始使用" })).toBeInTheDocument();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });
});
