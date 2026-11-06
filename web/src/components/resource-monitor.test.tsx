import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./i18n-provider";
import { ResourceMonitor } from "./resource-monitor";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { useSystemResources, type SystemResources } from "@/lib/use-system-resources";

vi.mock("@/lib/use-system-resources", () => ({ useSystemResources: vi.fn() }));
const stats: SystemResources = {
  ts: 1, cpu: { systemPct: 30, processPct: 2.5, cores: 8 },
  memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, processRssBytes: 1024 ** 3 },
  disk: { usedBytes: 100 * 1024 ** 3, totalBytes: 200 * 1024 ** 3, freeBytes: 100 * 1024 ** 3 },
  gpu: { name: "Test GPU", utilizationPct: 15, memUsedBytes: 1024 ** 3, memTotalBytes: 4 * 1024 ** 3 },
};
afterEach(() => window.localStorage.removeItem(LOCALE_STORAGE_KEY));

describe("resource monitor localization", () => {
  it.each([15, null])("localizes the card and GPU fallback (utilization: %s)", async (gpuPct) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    vi.mocked(useSystemResources).mockReturnValue({ ...stats, gpu: { ...stats.gpu!, utilizationPct: gpuPct } });
    render(<I18nProvider><ResourceMonitor /></I18nProvider>);
    await userEvent.hover(screen.getByRole("button", { name: /系统资源：CPU 30%，内存 50%/ }));
    expect(await screen.findByText("系统资源")).toBeInTheDocument();
    expect(screen.getByText("内存")).toBeInTheDocument();
    expect(screen.getByText("磁盘")).toBeInTheDocument();
    expect(screen.getByText("8 核 · 应用占用 2.5%")).toBeInTheDocument();
    expect(screen.getByText("Test GPU")).toBeInTheDocument();
    expect(screen.getByText(/整机资源使用情况/)).toBeInTheDocument();
    if (gpuPct === null) expect(screen.getByText(/未提供利用率指标/)).toBeInTheDocument();
  });
});
