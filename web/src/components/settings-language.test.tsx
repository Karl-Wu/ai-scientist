import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "./i18n-provider";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import * as caps from "@/lib/capabilities";
import * as agents from "@/lib/agents";
import * as mcp from "@/lib/mcp";
import * as settings from "@/lib/app-settings";
import { ProvidersPanel } from "./settings/providers-panel";
import { DefaultsPanel } from "./settings/defaults-panel";
import { ProjectSettingsPanel } from "./settings/project-settings-panel";
import { ServicesPanel } from "./settings/services-panel";
import { SkillsPanel } from "./skills-panel";
import { PromptsPanel } from "./prompts-panel";
import { SubagentsPanel } from "./subagents-panel";
import { ConnectorsPanel } from "./connectors-panel";
vi.mock("@/lib/ui-locale-settings", () => ({ readSavedLocale: async () => "zh-CN", saveLocale: vi.fn() }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => ({ activeProjectId: "p1", activeProject: { id: "p1", name: "Original project", tags: [] }, projects: [{ id: "p1", name: "Original project", tags: [] }] }) }));
vi.mock("@/lib/use-provider-auth", async (original) => ({ ...await original<typeof import("@/lib/use-provider-auth")>(), useProviderAuth: () => ({ providers: [], loading: false, refresh: vi.fn() }) }));
vi.mock("@/lib/use-modal-jobs", async (original) => ({ ...await original<typeof import("@/lib/use-modal-jobs")>(), useModalCatalog: () => ({ catalog: null, loading: false, refresh: vi.fn() }) }));
vi.mock("@/lib/projects", async (original) => ({ ...await original<typeof import("@/lib/projects")>(), apiFetch: vi.fn(async (url) => new Response(JSON.stringify(url === "/providers" ? { providers: [] } : {}))), getProjectInstructionsStatus: async () => "current", getProjectGuardPolicy: async () => ({ version: 1, protectedPaths: ["user_data/**"], destructiveConfirm: true }), getProjectCompaction: async () => ({ enabled: true, reserveTokens: 16000, keepRecentTokens: 20000, bounds: { reserveTokens: { min: 4000, max: 64000 }, keepRecentTokens: { min: 5000, max: 200000 } } }) }));
beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  vi.spyOn(caps, "getAllSkills").mockResolvedValue({ scope: "project", enabled: [], disabled: [], problems: [], shadowed: [] });
  vi.spyOn(caps, "listPromptTemplates").mockResolvedValue([{ name: "qc", description: "Original research instructions", scope: "project" }]);
  vi.spyOn(agents, "getAgents").mockResolvedValue([]);
  vi.spyOn(agents, "getSpecialistDefaultModel").mockResolvedValue(null);
  vi.spyOn(agents, "getWatchdogSettings").mockResolvedValue({ enabled: false, model: "", thinking: "", cadenceEveryNTools: null, severityThreshold: "concern", children: false, watchdogMd: true, stalemateRepeats: 3, metered: true });
  vi.spyOn(mcp, "getMcpListing").mockResolvedValue({ mcpServers: {}, shared: [] });
  vi.spyOn(mcp, "getMcpAuthProviders").mockResolvedValue([]);
  vi.spyOn(mcp, "getRadiusConnector").mockResolvedValue({ signedIn: false, configured: false, name: null, url: "https://radius.pi.dev/mcp" });
  vi.spyOn(settings, "getAppDefaults").mockResolvedValue({});
  vi.spyOn(settings, "getImageModels").mockResolvedValue({ models: [], builtIn: [] });
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it.each([
  ["providers", <ProvidersPanel />, "模型提供商", "添加提供商"],
  ["defaults", <DefaultsPanel />, "新会话默认设置", "保存默认设置"],
  ["general", <ProjectSettingsPanel projectId="p1" />, "项目设置 · Original project", "常规与预算"],
  ["skills", <SkillsPanel />, "技能", "新建技能"],
  ["prompts", <PromptsPanel />, "提示词模板", "新建模板"],
  ["specialists", <SubagentsPanel />, "专家助手", "添加专家"],
  ["connectors", <ConnectorsPanel />, "连接器", "添加连接器"],
  ["services", <ServicesPanel />, "服务", "网页搜索"],
])("renders %s settings in Chinese", async (_name, panel, heading, control) => {
  render(<I18nProvider>{panel}</I18nProvider>);
  expect(await screen.findByRole("heading", { name: heading as string })).toBeInTheDocument();
  expect((await screen.findAllByText(control as string)).length).toBeGreaterThan(0);
});
it("keeps prompt content intact in the Chinese editor", async () => {
  vi.spyOn(caps, "getPromptTemplateSource").mockResolvedValue({ name: "qc", scope: "project", content: "Original instructions: run $1" });
  render(<I18nProvider><PromptsPanel /></I18nProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "编辑 qc" }));
  expect(await screen.findByLabelText("qc 的模板源文件")).toHaveValue("Original instructions: run $1");
});

it("localizes shared project save controls and instruction status", async () => {
  render(<I18nProvider><ProjectSettingsPanel projectId="p1" /></I18nProvider>);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "保存" })).toHaveLength(3));
  expect(await screen.findByText("与 AI Scientist 当前内置指令一致。")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("Original project");
});
