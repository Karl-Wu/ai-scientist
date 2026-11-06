"use client";

import { useSettingsT as useT } from "@/components/settings/use-settings-t";

/**
 * Settings → Project → Specialists.
 *
 * Lists the agents available to the `subagent` delegation tool (pi-subagents):
 * project agents from sandbox/.pi/agents/*.md (editable) and the package's
 * builtin agents (read-only — "Customize" copies one into the project, where
 * it shadows the builtin by name). Mirrors the MCP servers panel's
 * list + inline-form interaction style.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ModelField } from "@/components/settings/model-field";
import {
  SettingsCard,
  SettingsError,
  SettingsHeader,
  SettingsSearch,
  matchesQuery,
} from "@/components/settings/primitives";
import { cn } from "@/lib/utils";
import {
  BotIcon,
  BrainIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { useProjects } from "@/lib/use-projects";
import {
  clearAgentMemory,
  deleteAgent,
  getAgentMemory,
  getAgents,
  getSpecialistDefaultModel,
  getWatchdogSettings,
  restoreDefaultAgents,
  saveAgent,
  saveAgentMemory,
  saveSpecialistDefaultModel,
  saveWatchdogSettings,
  setAgentEnabled,
  THINKING_LEVELS,
  type AgentFile,
  type AgentMemoryFile,
  type WatchdogSettings,
} from "@/lib/agents";

interface AgentFormState {
  /** Name being edited, or null when creating a new agent. */
  originalName: string | null;
  name: string;
  description: string;
  model: string;
  thinking: string;
  tools: string;
  systemPromptMode: "append" | "replace";
  inheritProjectContext: boolean;
  inheritSkills: boolean;
  memoryEnabled: boolean;
  memoryScope: "project" | "user";
  extra?: Record<string, unknown>;
  systemPrompt: string;
}

const EMPTY_FORM: AgentFormState = {
  originalName: null,
  name: "",
  description: "",
  model: "",
  thinking: "",
  tools: "",
  systemPromptMode: "append",
  inheritProjectContext: true,
  inheritSkills: true,
  memoryEnabled: false,
  memoryScope: "project",
  systemPrompt: "",
};

function formFromAgent(agent: AgentFile, asCopy: boolean): AgentFormState {
  return {
    originalName: asCopy ? null : agent.name,
    name: agent.name,
    description: agent.description,
    model: agent.model ?? "",
    thinking: agent.thinking ?? "",
    tools: agent.tools ?? "",
    systemPromptMode: agent.systemPromptMode ?? "append",
    inheritProjectContext: agent.inheritProjectContext ?? true,
    inheritSkills: agent.inheritSkills ?? true,
    memoryEnabled: Boolean(agent.memory),
    memoryScope: agent.memory?.scope ?? "project",
    extra: agent.extra,
    systemPrompt: agent.systemPrompt,
  };
}

/**
 * Settings card for pi-subagents' opt-in watchdog: a second model that
 * reviews each turn's edits and steers findings into the chat.
 */
export function WatchdogCard({ projectId }: { projectId: string }) {
  const t = useT();
  const [settings, setSettings] = useState<WatchdogSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Latest settings for `update`: consecutive edits must not roll back to a
  // snapshot captured before the previous save landed.
  const settingsRef = useRef<WatchdogSettings | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    getWatchdogSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((exc) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "Failed to load watchdog settings");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const update = useCallback(async (patch: Partial<Omit<WatchdogSettings, "metered">>) => {
    const previous = settingsRef.current;
    if (!previous) return;
    setSettings({ ...previous, ...patch });
    setSaving(true);
    setError(null);
    try {
      setSettings(await saveWatchdogSettings(patch));
    } catch (exc) {
      setSettings(previous);
      setError(exc instanceof Error ? exc.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, []);

  // Number fields commit on blur/Enter, never per keystroke (typing "50"
  // would otherwise send 5 — below the minimum — before 50).
  const [cadenceDraft, setCadenceDraft] = useState<string | null>(null);
  const [stalemateDraft, setStalemateDraft] = useState<string | null>(null);
  const commitCadence = () => {
    if (cadenceDraft === null || !settings) return;
    const raw = cadenceDraft.trim();
    setCadenceDraft(null);
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 5 || next > 500)) {
      setError("Mid-turn review cadence must be a whole number from 5 to 500 (or empty).");
      return;
    }
    if (next !== settings.cadenceEveryNTools) void update({ cadenceEveryNTools: next });
  };
  const commitStalemate = () => {
    if (stalemateDraft === null || !settings) return;
    const next = Number(stalemateDraft.trim());
    setStalemateDraft(null);
    if (!Number.isInteger(next) || next < 1 || next > 20) {
      setError("Stalemate repeats must be a whole number from 1 to 20.");
      return;
    }
    if (next !== settings.stalemateRepeats) void update({ stalemateRepeats: next });
  };

  return (
    <section className="rounded-lg border p-3" aria-label={t("Watchdog")} data-testid="watchdog-card">
      <div className="flex items-center gap-2">
        <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">{t("Watchdog")}</div>
          <p className="text-[11px] text-muted-foreground">
            {t("A second model reviews what the agent just did and steers findings into the chat: raw data touched, silent row drops, unlogged parameter changes, claims without evidence. Per project; applies to new chat tabs.")}{" "}</p>
        </div>
        <Switch
          aria-label={t("Enable watchdog")}
          checked={settings?.enabled ?? false}
          disabled={!settings || saving}
          onCheckedChange={(enabled) => void update({ enabled })}
        />
      </div>
      <p className="mt-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
        {t("Watchdog reviews add model usage. AI Scientist records it in the project ledger and checks the spend cap before each paid request. Subscription and local models follow their usual billing rules.")}{" "}</p>
      <SettingsError className="mt-2">{error}</SettingsError>
      {settings?.enabled && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="text-[11px] text-muted-foreground">
            {t("Model")}{" "}<ModelField
              className="mt-1"
              label={t("Watchdog model")}
              value={settings.model}
              emptyLabel="Inherit the chat's model"
              disabled={saving}
              onChange={(model) => {
                if (model !== settings.model) void update({ model });
              }}
            />
          </div>
          <label className="text-[11px] text-muted-foreground">
            {t("Thinking")}{" "}<select
              className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
              aria-label={t("Watchdog thinking level")}
              value={settings.thinking}
              onChange={(e) => void update({ thinking: e.target.value })}
            >
              <option value="">{t("inherit from chat")}</option>
              {THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            {t("Also review mid-turn every N tool calls (empty = only at turn end)")}{" "}<Input
              type="number"
              min={5}
              max={500}
              className="mt-1 h-8 text-xs"
              aria-label={t("Watchdog cadence")}
              value={cadenceDraft ?? String(settings.cadenceEveryNTools ?? "")}
              onChange={(e) => setCadenceDraft(e.target.value)}
              onBlur={commitCadence}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCadence();
              }}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            {t("Report")}{" "}<select
              className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
              aria-label={t("Watchdog severity threshold")}
              value={settings.severityThreshold}
              onChange={(e) => void update({ severityThreshold: e.target.value as WatchdogSettings["severityThreshold"] })}
            >
              <option value="concern">{t("concerns and blockers")}</option>
              <option value="blocker">{t("blockers only")}</option>
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground sm:col-span-2">
            {t("Stop a turn after the same warning repeats this many times in a row (1–20)")}{" "}<Input
              type="number"
              min={1}
              max={20}
              className="mt-1 h-8 w-24 text-xs"
              aria-label={t("Watchdog stalemate repeats")}
              value={stalemateDraft ?? String(settings.stalemateRepeats)}
              onChange={(e) => setStalemateDraft(e.target.value)}
              onBlur={commitStalemate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitStalemate();
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground sm:col-span-2">
            {t("Also review background specialists' own turns")}{" "}<Switch
              aria-label={t("Watch specialists")}
              checked={settings.children}
              disabled={saving}
              onCheckedChange={(children) => void update({ children })}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground sm:col-span-2">
            {t("Read the project's")}{" "}<code>.pi/WATCHDOG.md</code> {t("standing instructions")}{" "}<Switch
              aria-label={t("Use WATCHDOG.md")}
              checked={settings.watchdogMd}
              disabled={saving}
              onCheckedChange={(watchdogMd) => void update({ watchdogMd })}
            />
          </label>
        </div>
      )}
    </section>
  );
}

/** Project `subagents.defaultModel`: the model for specialists that pin none. */
function SpecialistDefaultModelCard({ projectId }: { projectId: string }) {
  const t = useT();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(null);
    getSpecialistDefaultModel()
      .then((model) => {
        if (!cancelled) setValue(model ?? "");
      })
      .catch((exc) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "Failed to load the default model");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const change = async (next: string) => {
    if (value === null || next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      setValue((await saveSpecialistDefaultModel(next || null)) ?? "");
    } catch (exc) {
      setValue(previous);
      setError(exc instanceof Error ? exc.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title={t("Default model for specialists")}
      description={t("Used by every specialist that does not pin its own model. Inherit keeps each specialist on the model of the chat that launched it.")}
    >
      {value === null ? (
        error ? <SettingsError>{error}</SettingsError> : <p className="text-[11px] text-muted-foreground">{t("Loading…")}</p>
      ) : (
        <>
          <ModelField
            label={t("Default specialist model")}
            value={value}
            emptyLabel="Inherit the chat's model"
            disabled={saving}
            onChange={(next) => void change(next)}
          />
          <SettingsError className="mt-2">{error}</SettingsError>
        </>
      )}
    </SettingsCard>
  );
}

export function SubagentsPanel() {
  const t = useT();
  const { activeProject, activeProjectId } = useProjects();
  const [agents, setAgents] = useState<AgentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<AgentFile | null>(null);
  const [query, setQuery] = useState("");
  const { confirm, dialog } = useConfirm();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setAgents(await getAgents());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Failed to load specialists");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setForm(null);
    setViewing(null);
    getAgents()
      .then((a) => {
        if (!cancelled) setAgents(a);
      })
      .catch((exc) => {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "Failed to load specialists");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const toggleEnabled = useCallback(
    async (name: string, next: boolean) => {
      setAgents((list) => list.map((a) => (a.name === name ? { ...a, enabled: next } : a)));
      try {
        await setAgentEnabled(name, next);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Toggle failed");
        void refresh(); // reconcile on failure
      }
    },
    [refresh],
  );

  const handleSave = useCallback(async () => {
    if (!form) return;
    const name = form.name.trim().toLowerCase();
    if (!name) {
      setError("Specialist name is required");
      return;
    }
    if (!form.systemPrompt.trim()) {
      setError("System prompt must not be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAgent(name, {
        description: form.description.trim(),
        model: form.model.trim() || undefined,
        thinking: form.thinking || undefined,
        tools: form.tools.trim() || undefined,
        systemPromptMode: form.systemPromptMode,
        inheritProjectContext: form.inheritProjectContext,
        inheritSkills: form.inheritSkills,
        memory: form.memoryEnabled ? { scope: form.memoryScope, path: name } : undefined,
        extra: form.extra,
        systemPrompt: form.systemPrompt,
      });
      // Renaming creates a new file; remove the old one so it doesn't linger.
      if (form.originalName && form.originalName !== name) {
        await deleteAgent(form.originalName).catch(() => {});
      }
      setForm(null);
      await refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, refresh]);

  const handleDelete = useCallback(
    async (name: string) => {
      const ok = await confirm({
        title: t("Delete {v0}?", { v0: name }),
        description: t("Removes .pi/agents/{name}.md from this project. Running chats keep the roster they started with.", { name }),
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      setSaving(true);
      setError(null);
      try {
        await deleteAgent(name);
        await refresh();
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Delete failed");
      } finally {
        setSaving(false);
      }
    },
    [confirm, refresh, t],
  );

  const handleRestore = useCallback(async () => {
    const ok = await confirm({
      title: t("Restore the default specialists?"),
      description:
        t("Re-seeds the default scientific roster. Project specialists with the same names are overwritten; custom specialists are untouched."),
      confirmLabel: "Restore defaults",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await restoreDefaultAgents();
      setForm(null);
      setViewing(null);
      await refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Restore failed");
    } finally {
      setSaving(false);
    }
  }, [confirm, refresh, t]);

  const [memoryOpen, setMemoryOpen] = useState<{ name: string; file: AgentMemoryFile | null; draft: string } | null>(null);
  const openMemory = useCallback(async (agent: AgentFile) => {
    if (memoryOpen?.name === agent.name) {
      setMemoryOpen(null);
      return;
    }
    setMemoryOpen({ name: agent.name, file: null, draft: "" });
    try {
      const file = await getAgentMemory(agent.name);
      setMemoryOpen({ name: agent.name, file, draft: file.content });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Failed to load memory");
      setMemoryOpen(null);
    }
  }, [memoryOpen]);
  const saveMemory = useCallback(async () => {
    if (!memoryOpen) return;
    setSaving(true);
    setError(null);
    try {
      await saveAgentMemory(memoryOpen.name, memoryOpen.draft);
      setMemoryOpen({ ...memoryOpen, file: memoryOpen.file ? { ...memoryOpen.file, exists: true, content: memoryOpen.draft } : null });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [memoryOpen]);
  const clearMemory = useCallback(async () => {
    if (!memoryOpen) return;
    const ok = await confirm({
      title: t("Clear the memory of {v0}?", { v0: memoryOpen.name }),
      description: t("Deletes its MEMORY.md. The specialist starts its next run without those notes."),
      confirmLabel: "Clear memory",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await clearAgentMemory(memoryOpen.name);
      setMemoryOpen({ ...memoryOpen, draft: "", file: memoryOpen.file ? { ...memoryOpen.file, exists: false, content: "" } : null });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }, [confirm, memoryOpen, t]);

  const visible = useMemo(
    () => agents.filter((a) => matchesQuery(query, a.name, a.description, a.model)),
    [agents, query],
  );
  const project = visible.filter((a) => a.source === "project");
  const builtins = visible.filter((a) => a.source === "builtin");

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <SettingsHeader
        title={t("Specialists")}
        description={
          <>
            {t("Specialist agents AI Scientist can delegate to with the")}{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">subagent</code> {t("tool, configured per project (current:")}{" "}
            <span className="font-medium">{activeProject?.name ?? activeProjectId}</span>{t(") as markdown files in")}{" "}<code className="rounded bg-muted px-1 py-0.5 text-[11px]">.pi/agents/</code>.
          </>
        }
        appliesTo="new-chats"
      />

      <SpecialistDefaultModelCard projectId={activeProjectId} />
      <WatchdogCard projectId={activeProjectId} />

      <SettingsError>{error}</SettingsError>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("Loading…")}</p>
      ) : form ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-xs font-medium">{t("Name")}</label>
              <Input
                value={form.name}
                placeholder={t("e.g. code-reviewer")}
                className="h-8 text-xs font-mono"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium">
                {t("Model")}{" "}
                <span className="font-normal text-muted-foreground">{t("(optional)")}</span>
              </span>
              <ModelField
                label={t("Specialist model")}
                value={form.model}
                emptyLabel="Inherit (specialist default or chat model)"
                onChange={(model) => setForm({ ...form, model })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{t("Description")}</label>
            <Input
              value={form.description}
              placeholder={t("One line shown to the main agent when it picks a specialist")}
              className="h-8 text-xs"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">
              {t("Thinking level")}{" "}
              <span className="font-normal text-muted-foreground">{t("(optional)")}</span>
            </label>
            <div className="flex flex-wrap gap-1">
              {["", ...THINKING_LEVELS].map((level) => (
                <Button
                  key={level || "inherit"}
                  variant={form.thinking === level ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setForm({ ...form, thinking: level })}
                >
                  {level || "inherit"}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">
              {t("Tools")}{" "}
              <span className="font-normal text-muted-foreground">
                {t("(comma-separated allowlist; empty = all tools)")}{" "}</span>
            </label>
            <Input
              value={form.tools}
              placeholder="read, grep, find, ls, bash"
              className="h-8 text-xs font-mono"
              onChange={(e) => setForm({ ...form, tools: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={form.inheritProjectContext}
                onCheckedChange={(v) => setForm({ ...form, inheritProjectContext: v })}
              />
              {t("Inherit project context (AGENTS.md)")}{" "}</label>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={form.inheritSkills}
                onCheckedChange={(v) => setForm({ ...form, inheritSkills: v })}
              />
              {t("Inherit skills")}{" "}</label>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={form.systemPromptMode === "replace"}
                onCheckedChange={(v) =>
                  setForm({ ...form, systemPromptMode: v ? "replace" : "append" })
                }
              />
              {t("Replace base system prompt")}{" "}</label>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border p-2.5">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                aria-label={t("Persistent memory")}
                checked={form.memoryEnabled}
                onCheckedChange={(v) => setForm({ ...form, memoryEnabled: v })}
              />
              {t("Persistent memory")}{" "}</label>
            {form.memoryEnabled && (
              <label className="flex items-center gap-2 text-xs">
                {t("Scope")}{" "}<select
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                  aria-label={t("Memory scope")}
                  value={form.memoryScope}
                  onChange={(e) => setForm({ ...form, memoryScope: e.target.value as "project" | "user" })}
                >
                  <option value="project">{t("this project")}</option>
                  <option value="user">{t("all projects")}</option>
                </select>
              </label>
            )}
            <p className="w-full text-[11px] text-muted-foreground">
              {t("A role-specific MEMORY.md the agent reads at the start of every run and may append dated notes to. Self-written by the model — instructions, not evidence.")}{" "}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{t("System prompt")}</label>
            <Textarea
              value={form.systemPrompt}
              placeholder={t("You are a …")}
              className="min-h-44 text-xs font-mono leading-relaxed"
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="text-xs"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? t("Saving…") : form.originalName ? t("Save changes") : t("Add specialist")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setForm(null)}
            >
              {t("Cancel")}{" "}</Button>
          </div>
        </div>
      ) : (
        <>
          <SettingsSearch
            value={query}
            onChange={setQuery}
            placeholder={t("Search specialists…")}
            label={t("Search specialists")}
          />
          <div className="flex flex-col gap-1.5">
            {project.map((agent) => (
              <div key={agent.name} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium font-mono">{agent.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {agent.description || t("(no description)")}
                  </div>
                </div>
                {agent.model ? (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-mono">
                    {agent.model}
                  </Badge>
                ) : (
                  <VerifierBadge agent={agent} />
                )}
                {agent.memory && (
                  <Button
                    variant={memoryOpen?.name === agent.name ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    aria-label={t("Memory of {v0}", { v0: agent.name })}
                    onClick={() => void openMemory(agent)}
                  >
                    <BrainIcon className="size-3.5" />
                    {t("Memory")}{" "}</Button>
                )}
                <Switch
                  aria-label={t("Toggle {v0}", { v0: agent.name })}
                  checked={agent.enabled !== false}
                  onCheckedChange={(v) => void toggleEnabled(agent.name, v)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  aria-label={t("Edit {v0}", { v0: agent.name })}
                  onClick={() => setForm(formFromAgent(agent, false))}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-destructive hover:text-destructive"
                  aria-label={t("Delete {v0}", { v0: agent.name })}
                  disabled={saving}
                  onClick={() => void handleDelete(agent.name)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
            {project.length === 0 && (
              <div className="rounded-lg border px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                {query.trim()
                  ? t("No project specialist matches.")
                  : t("No project specialists yet. Add one, or restore the default scientific roster below.")}
              </div>
            )}
          </div>

          {memoryOpen && (
            <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="agent-memory-pane">
              <div className="flex items-center gap-2 text-xs font-medium">
                <BrainIcon className="size-3.5 text-muted-foreground" />
                {t("Memory of")}{" "}{memoryOpen.name}
                {memoryOpen.file && (
                  <span className="font-normal text-muted-foreground">
                    · {memoryOpen.file.memory.scope === "user" ? t("all projects") : t("this project")} {" "}{t("· first")}{" "}
                    {memoryOpen.file.limits.lines} {t("lines are injected")}{" "}</span>
                )}
              </div>
              {!memoryOpen.file ? (
                <p className="text-[11px] text-muted-foreground">{t("Loading…")}</p>
              ) : (
                <>
                  {!memoryOpen.file.exists && !memoryOpen.draft && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("Nothing written yet. The agent creates this file on its first run; you can also seed it here.")}{" "}</p>
                  )}
                  <Textarea
                    value={memoryOpen.draft}
                    spellCheck={false}
                    className="min-h-40 font-mono text-[11px]"
                    aria-label={t("MEMORY.md for {v0}", { v0: memoryOpen.name })}
                    onChange={(e) => setMemoryOpen({ ...memoryOpen, draft: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => void saveMemory()}>
                      {t("Save memory")}{" "}</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={saving} onClick={() => void clearMemory()}>
                      {t("Clear")}{" "}</Button>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setMemoryOpen(null)}>
                      {t("Close")}{" "}</Button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <PlusIcon className="size-3.5" />
              {t("Add specialist")}{" "}</Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground"
              disabled={saving}
              onClick={() => void handleRestore()}
              title={t("Re-seed the default scientific specialists (overwrites same-named project specialists; custom ones are untouched)")}
            >
              <RotateCcwIcon className="size-3.5" />
              {t("Restore defaults")}{" "}</Button>
          </div>

          {builtins.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h4 className="mt-1 text-xs font-medium text-muted-foreground">
                {t("Built-in specialists")}{" "}
                <span className="font-normal">
                  {t("(from pi-subagents — customize to override)")}{" "}</span>
              </h4>
              {builtins.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
                >
                  <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium font-mono">
                      {agent.name}
                      <VerifierBadge agent={agent} />
                    </div>
                    <div
                      className={cn(
                        "text-[11px] text-muted-foreground",
                        viewing?.name === agent.name ? "" : "truncate",
                      )}
                    >
                      {agent.description || t("(no description)")}
                    </div>
                    {viewing?.name === agent.name && (
                      <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px] leading-relaxed">
                        {agent.systemPrompt}
                      </pre>
                    )}
                  </div>
                  <Switch
                    aria-label={t("Toggle {v0}", { v0: agent.name })}
                    checked={agent.enabled !== false}
                    onCheckedChange={(v) => void toggleEnabled(agent.name, v)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      setViewing(viewing?.name === agent.name ? null : agent)
                    }
                  >
                    {viewing?.name === agent.name ? t("Hide") : t("View")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setForm(formFromAgent(agent, true))}
                  >
                    {t("Customize")}{" "}</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Marks a specialist the Settings → Defaults verifier model covers. */
function VerifierBadge({ agent }: { agent: AgentFile }) {
  const t = useT();
  if (!agent.verifier) return null;
  return (
    <Badge
      variant="outline"
      className="hidden sm:inline-flex text-[10px] font-mono"
      title={
        agent.verifierModel
          ? t("Verifier: runs on {v0} (Settings → Defaults → Verifier model)", { v0: agent.verifierModel })
          : t("Verifier: set a verifier model in Settings → Defaults to check work with a different model")
      }
    >
      {agent.verifierModel ? t("verifier · {v0}", { v0: agent.verifierModel }) : t("verifier")}
    </Badge>
  );
}
