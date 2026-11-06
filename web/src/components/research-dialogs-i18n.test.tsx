import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "./i18n-provider";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { NotebookPlanDialog } from "./notebook-plan-dialog";
import { NotebookRobustnessDialog } from "./notebook-robustness-dialog";
import { NextExperimentsDialog } from "./next-experiments-dialog";
import { experimentSource, experimentView } from "@/test/next-experiments-fixture";
import { robustnessDraft, robustnessPreview } from "@/test/robustness-fixture";
import type { AnalysisPlanInput } from "@/lib/notebook-plans";
vi.mock("@/lib/projects", async (original) => ({ ...await original<typeof import("@/lib/projects")>(), apiFetch: vi.fn() }));
const { apiFetch } = await import("@/lib/projects");
const fetch = vi.mocked(apiFetch);
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const plan: AnalysisPlanInput = { hypothesis: "Original scientific text", primaryOutcome: "Mean score", exclusions: "QC", model: "Linear model", multiplicity: "One test", qc: "No missingness", stopping: "100 samples", exposureNotes: "Unknown", datasets: ["data.csv"], intent: "exploratory", priorExposure: "unknown" };
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN"); });
afterEach(() => localStorage.removeItem(LOCALE_STORAGE_KEY));

it("localizes the analysis-plan review and form while preserving protocol values and scientific content", async () => {
  fetch.mockResolvedValue(json({ source: { sessionId: "s1", entryId: "h1" }, head: null, events: [] }));
  render(<I18nProvider><NotebookPlanDialog entry={{ id: "h1", type: "hypothesis", title: "Original title", timestamp: 1, analysisPlan: plan }} sessionId="s1" projectId="project-a" /></I18nProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "审阅拟议分析计划" }));
  expect(screen.getByRole("heading", { name: "分析计划" })).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "准备计划" }));
  expect(screen.getByLabelText("假设 / 研究问题")).toHaveValue(plan.hypothesis);
  expect(screen.getByLabelText("分析意图")).toHaveValue("exploratory");
  await user.selectOptions(screen.getByLabelText("先前数据接触情况"), "outcomes-inspected");
  expect(screen.getByLabelText("先前数据接触情况")).toHaveValue("outcomes-inspected");
  expect(screen.getByLabelText("数据集路径")).toHaveValue("data.csv");
  expect(fetch.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
});

it("localizes robustness preparation and cost approvals without submitting a job", async () => {
  fetch.mockImplementation(async (url) => json(String(url).endsWith("/plans") ? { head: "head-1", events: [{ kind: "freeze", id: "plan-1", revision: 1 }] } : String(url) === "/modal/instances" ? { instances: [{ id: "cpu-2", label: "CPU 2", pricePerHour: 0.1 }] } : String(url).endsWith("/preview") ? robustnessPreview : { workflows: [], configured: true }));
  render(<I18nProvider><NotebookRobustnessDialog entry={{ id: "h1", type: "hypothesis", title: "Original title", timestamp: 1, robustness: robustnessDraft }} sessionId="s1" projectId="project-a" onOpenFile={vi.fn()} /></I18nProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "检验发现的稳健性" }));
  await user.click(await screen.findByRole("button", { name: "准备稳健性检验工作流" }));
  expect(screen.getByLabelText("已有 Python 脚本")).toHaveValue("analysis.py");
  expect(screen.getByLabelText("变体 1 随机种子")).toHaveValue(42);
  await user.click(screen.getByRole("button", { name: "准备快照与费用估算" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "批准并提交批次" })).toBeDisabled());
  expect(screen.getByRole("checkbox", { name: /我授权上传这些文件/ })).not.toBeChecked();
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/approve"))).toBe(false);
});

it("localizes next-step proposals and preferences while keeping generated research and selection values intact", async () => {
  fetch.mockResolvedValue(json(experimentView));
  render(<I18nProvider><NextExperimentsDialog entry={{ id: experimentSource.entryId, type: "hypothesis", title: "Original title", timestamp: 1 }} sessionId={experimentSource.sessionId} projectId="project-a" /></I18nProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "下一步做什么？" }));
  expect(screen.getByRole("heading", { name: "下一步应检验什么？" })).toBeInTheDocument();
  await user.click(await screen.findByText("生成关联来源的建议"));
  expect(screen.getByRole("button", { name: "生成建议" })).toBeDisabled();
  expect(screen.getAllByText(experimentView.proposals[0].plan.experiments[0].title).length).toBeGreaterThan(0);
  await user.click(screen.getAllByRole("button", { name: "记录规划偏好" })[0]);
  fireEvent.change(screen.getByLabelText("规划偏好"), { target: { value: "defer" } });
  expect(screen.getByLabelText("规划偏好")).toHaveValue("defer");
  expect(fetch.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
});
