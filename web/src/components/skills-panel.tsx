"use client";

import { useSettingsT as useT } from "@/components/settings/use-settings-t";

/**
 * Settings → Skills.
 *
 * Three kinds of skill live side by side and the row badges say which is which:
 * the K-Dense catalogue (synced daily, non-destructively), skills the user
 * installed from any source the `skills` CLI understands, and skills written
 * here. Only catalogue skills auto-update; the others are checked on request.
 *
 * Scope switches between this project's sandbox and the user-level dir shared by
 * every project.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjects } from "@/lib/use-projects";
import {
  checkSkillUpdate,
  createSkill,
  EMPTY_SKILL_SYNC_STATUS,
  getAllSkills,
  getSkillSource,
  installSkills,
  previewSkillSource,
  removeSkill,
  saveSkillSource,
  setSkillEnabled,
  setSkillModelInvocation,
  syncSkills,
  updateSkillFromUpstream,
  type PreviewedSkill,
  type SkillInfo,
  type SkillOrigin,
  type SkillProblem,
  type SkillScope,
  type SkillSourcePreview,
  type SkillSyncStatus,
} from "@/lib/capabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ScopeSwitcher,
  SettingsError,
  SettingsHeader,
  SettingsNotice,
  SettingsSearch,
  matchesQuery,
} from "@/components/settings/primitives";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  DownloadIcon,
  SlashIcon,
} from "lucide-react";

interface Row extends SkillInfo {
  enabled: boolean;
}

const ORIGIN_LABEL: Record<SkillOrigin, string> = {
  catalogue: "K-Dense",
  registry: "Installed",
  local: "Local",
};

type Pane = "none" | "install" | "create" | "edit";

export function SkillsPanel() {
  const t = useT();
  const { activeProject, activeProjectId } = useProjects();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [scope, setScope] = useState<SkillScope>("project");
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<SkillProblem[]>([]);
  const [shadowed, setShadowed] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<SkillSyncStatus>(
    EMPTY_SKILL_SYNC_STATUS,
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<Pane>("none");

  // Install pane
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [preview, setPreview] = useState<SkillSourcePreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Create pane
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Edit pane
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const load = useCallback(
    async (nextScope: SkillScope, showLoading = true) => {
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const listing = await getAllSkills(nextScope);
        const merged: Row[] = [
          ...listing.enabled.map((s) => ({ ...s, enabled: true })),
          ...listing.disabled.map((s) => ({ ...s, enabled: false })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        setRows(merged);
        setShadowed(listing.shadowed);
        setSyncStatus(listing.sync ?? EMPTY_SKILL_SYNC_STATUS);
        // Skills that failed to parse are absent from both lists above; without
        // this the only symptom is a skill missing from the catalogue.
        setProblems(listing.problems.filter((p) => !p.loaded));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Failed to load skills");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(scope);
  }, [load, scope, activeProjectId]);

  const run = useCallback(
    async (key: string, work: () => Promise<string | void>) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const message = await work();
        if (message) setNotice(message);
        await load(scope, false);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Operation failed");
      } finally {
        setBusy(null);
      }
    },
    [load, scope],
  );

  const toggle = useCallback(
    async (name: string, next: boolean) => {
      setRows((rs) => rs.map((r) => (r.name === name ? { ...r, enabled: next } : r)));
      try {
        await setSkillEnabled(name, next, scope);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Toggle failed");
        void load(scope, false); // reconcile on failure
      }
    },
    [load, scope],
  );

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncSkills();
      await load(scope, false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Skill synchronization failed");
    } finally {
      setSyncing(false);
    }
  }, [load, scope]);

  const closePanes = useCallback(() => {
    setPane("none");
    setPreview(null);
    setPicked(new Set());
    setAcknowledged(false);
    setEditing(null);
    setEditContent("");
    // Clear the source too. A leftover value in a reopened form invites typing
    // into the middle of the previous one and fetching a mangled hybrid.
    setSource("");
    setRef("");
  }, []);

  const doPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const result = await previewSkillSource({
        source: source.trim(),
        ref: ref.trim() || undefined,
        scope,
      });
      setPreview(result);
      // Preselect what isn't already here; re-installing an existing skill
      // should be a deliberate choice, not the default.
      setPicked(new Set(result.skills.filter((s) => !s.installed).map((s) => s.name)));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not read that source");
    } finally {
      setPreviewing(false);
    }
  }, [ref, scope, source]);

  const doInstall = useCallback(async () => {
    if (!preview) return;
    const names = [...picked];
    const replacing = preview.skills.some((s) => s.installed && picked.has(s.name));
    await run("install", async () => {
      const result = await installSkills({
        source: preview.source,
        ref: preview.ref,
        names,
        scope,
        stagingToken: preview.stagingToken,
        replace: replacing,
        acknowledged: true,
      });
      closePanes();
      const parts = [((result.installed.length === 1 ? "" : "s") === "" ? t("Installed {v0} skill", {v0: result.installed.length}) : t("Installed {v0} skills", {v0: result.installed.length}))];
      if (result.conflicts.length > 0) {
        parts.push(t("skipped {v0} (already installed)", { v0: result.conflicts.join(", ") }));
      }
      return t("{v0}. New chat tabs pick them up.", { v0: parts.join("; ") });
    });
  }, [closePanes, picked, preview, run, scope, t]);

  const doCreate = useCallback(async () => {
    const name = newName.trim().toLowerCase();
    await run("create", async () => {
      await createSkill({ name, description: newDescription.trim() || undefined, scope });
      setNewName("");
      setNewDescription("");
      closePanes();
      // Drop straight into the editor: a template on its own does nothing.
      setEditing(name);
      setPane("edit");
      setEditLoading(true);
      try {
        setEditContent(await getSkillSource(name, scope));
      } finally {
        setEditLoading(false);
      }
      return t("Created {v0}.", { v0: name });
    });
  }, [closePanes, newDescription, newName, run, scope, t]);

  const openEditor = useCallback(
    async (name: string) => {
      setPane("edit");
      setEditing(name);
      setEditLoading(true);
      setError(null);
      try {
        setEditContent(await getSkillSource(name, scope));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Could not read that skill");
      } finally {
        setEditLoading(false);
      }
    },
    [scope],
  );

  const saveEditor = useCallback(async () => {
    if (!editing) return;
    await run("save", async () => {
      await saveSkillSource(editing, editContent, scope);
      const name = editing;
      closePanes();
      return t("Saved {v0}.", { v0: name });
    });
  }, [closePanes, editContent, editing, run, scope, t]);

  const doRemove = useCallback(
    async (row: Row) => {
      const origin = row.origin ?? "catalogue";
      const consequence =
        origin === "catalogue"
          ? t("\"{v0}\" will be archived and kept out of future catalogue syncs.", { v0: row.name })
          : t("\"{v0}\" will be deleted.", { v0: row.name });
      const ok = await confirm({
        title: origin === "catalogue" ? "Archive skill?" : "Delete skill?",
        description: consequence,
        confirmLabel: origin === "catalogue" ? "Archive" : "Delete",
        destructive: true,
      });
      if (!ok) return;
      await run(`remove:${row.name}`, async () => {
        const result = await removeSkill(row.name, scope);
        return result.disposition === "archived"
          ? t("Archived {v0} (kept in .pi/skills-archived).", { v0: result.name })
          : t("Deleted {v0}.", { v0: result.name });
      });
    },
    [confirm, run, scope, t],
  );

  const doCheckUpdate = useCallback(
    async (name: string) => {
      await run(`check:${name}`, async () => {
        const result = await checkSkillUpdate(name, scope);
        return result.updateAvailable
          ? t("{v0} has an update available.", { v0: name })
          : t("{v0} is up to date.", { v0: name });
      });
    },
    [run, scope, t],
  );

  const replaceWithUpstream = useCallback(
    async (row: Row) => {
      const origin = row.origin ?? "catalogue";
      const where = origin === "catalogue" ? "the current upstream version" : row.source;
      const ok = await confirm({
        title: t("Replace \"{v0}\"?", { v0: row.name }),
        description: t("This replaces the local skill with {v0}. Local edits to this skill will be lost.", { v0: where ?? "" }),
        confirmLabel: "Replace",
        destructive: true,
      });
      if (!ok) return;
      await run(`update:${row.name}`, async () => {
        await updateSkillFromUpstream(row.name, scope);
        return t("Updated {v0}.", { v0: row.name });
      });
    },
    [confirm, run, scope, t],
  );

  const filtered = useMemo(
    () => rows.filter((r) => matchesQuery(query, r.name, r.description)),
    [query, rows],
  );

  const switchScope = useCallback(
    async (next: SkillScope) => {
      if (pane === "edit" && editing) {
        const ok = await confirm({
          title: t("Discard unsaved changes to {v0}?", { v0: editing }),
          description: t("Switching scope closes the editor without saving."),
          confirmLabel: "Discard",
        });
        if (!ok) return;
      }
      closePanes();
      setScope(next);
    },
    [closePanes, confirm, editing, pane, t],
  );

  const shadowedSet = useMemo(() => new Set(shadowed), [shadowed]);

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <SettingsHeader
        title={t("Skills")}
        description={t("Skills the agent can activate. The K-Dense catalogue syncs daily without overwriting local edits; skills you install or write are left alone until you ask. Disabling one hides it from the agent.")}
        appliesTo="new-chats"
        actions={
          <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              closePanes();
              setPane(pane === "install" ? "none" : "install");
            }}
          >
            <PlusIcon className="size-3.5" />
            {t("Add")}{" "}</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              closePanes();
              setPane(pane === "create" ? "none" : "create");
            }}
          >
            {t("New skill")}{" "}</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={syncing || scope === "global"}
            title={
              scope === "global"
                ? t("The catalogue is per project; switch to this project to sync it.")
                : undefined
            }
            onClick={() => void refresh()}
          >
            {syncing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            {t("Sync catalogue")}{" "}</Button>
          </>
        }
      />

      <ScopeSwitcher
        value={scope}
        onChange={(next) => void switchScope(next)}
        projectName={activeProject?.name ?? activeProjectId}
      />

      {scope === "global" && (
        <p className="text-[11px] text-muted-foreground">
          {t("Stored in your AI Scientist Pi agent directory: available to every project and to subagents. A project skill of the same name takes precedence.")}{" "}</p>
      )}

      <SettingsError>{error}</SettingsError>
      <SettingsNotice>{notice}</SettingsNotice>

      {/* Install from a source */}
      {pane === "install" && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="text-xs font-medium">{t("Add skills from a source")}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={source}
              placeholder={t("owner/repo, a git URL, or a local path")}
              className="h-8 flex-1 text-xs"
              onChange={(e) => setSource(e.target.value)}
            />
            <Input
              value={ref}
              placeholder={t("branch / tag (optional)")}
              className="h-8 text-xs sm:w-44"
              onChange={(e) => setRef(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!source.trim() || previewing}
              onClick={() => void doPreview()}
            >
              {previewing ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              {t("Look up")}{" "}</Button>
          </div>

          {previewing && (
            <p className="text-[11px] text-muted-foreground">
              {t("Downloading the source to see what it contains…")}{" "}</p>
          )}

          {preview && (
            <>
              <div className="text-[11px] text-muted-foreground">
                {t(preview.skills.length === 1 ? "{count} skill in" : "{count} skills in", { count: preview.skills.length })}{" "}
                <span className="font-medium">{preview.source}</span>
                {preview.ref ? ` (${preview.ref})` : ""}
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {preview.skills.map((s: PreviewedSkill) => (
                  <label
                    key={s.name}
                    className="flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={picked.has(s.name)}
                      aria-label={t("Select {v0}", { v0: s.name })}
                      onChange={(e) => {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.name);
                          else next.delete(s.name);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                        {s.name}
                        {s.installed && (
                          <Badge variant="outline" className="h-5 text-[10px]">
                            {t("Already installed — will be replaced")}{" "}</Badge>
                        )}
                        {s.conflictsWith === "project" && (
                          <Badge variant="outline" className="h-5 text-[10px]">
                            {t("A project skill of this name takes precedence")}{" "}</Badge>
                        )}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {s.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {preview.problems.length > 0 && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[11px]">
                  {t("{count} skills cannot be installed.", { count: preview.problems.length })}{" "}</div>
              )}

              <label className="flex items-start gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  aria-label={t("Trust this source")}
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  {t("I trust")}{" "}<span className="font-medium">{preview.source}</span>{t(". Skills are instructions the agent follows, and they run with its full permissions.")}{" "}</span>
              </label>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={picked.size === 0 || !acknowledged || busy === "install"}
                  onClick={() => void doInstall()}
                >
                  {busy === "install" && (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  {t("Install")}{" "}{picked.size > 0 ? `${picked.size} ` : ""}
                  {t(picked.size === 1 ? "skill" : "skills")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={closePanes}
                >
                  {t("Cancel")}{" "}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Author a new skill */}
      {pane === "create" && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="text-xs font-medium">{t("New skill")}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newName}
              placeholder={t("skill-name (lowercase, hyphens)")}
              className="h-8 text-xs sm:w-56"
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              value={newDescription}
              placeholder={t("What it does and when to use it")}
              className="h-8 flex-1 text-xs"
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("The description is what the model matches against when deciding whether to activate a skill, so make it specific.")}{" "}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={!newName.trim() || busy === "create"}
              onClick={() => void doCreate()}
            >
              {busy === "create" && <Loader2Icon className="size-3.5 animate-spin" />}
              {t("Create and edit")}{" "}</Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={closePanes}
            >
              {t("Cancel")}{" "}</Button>
          </div>
        </div>
      )}

      {/* Edit SKILL.md */}
      {pane === "edit" && editing && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="text-xs font-medium">{t("Editing")}{" "}{editing}/SKILL.md</div>
          {editLoading ? (
            <p className="text-[11px] text-muted-foreground">{t("Loading…")}</p>
          ) : (
            <Textarea
              value={editContent}
              spellCheck={false}
              className="min-h-64 font-mono text-[11px]"
              aria-label={t("SKILL.md for {v0}", { v0: editing })}
              onChange={(e) => setEditContent(e.target.value)}
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={busy === "save" || editLoading}
              onClick={() => void saveEditor()}
            >
              {busy === "save" && <Loader2Icon className="size-3.5 animate-spin" />}
              {t("Save")}{" "}</Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={closePanes}
            >
              {t("Cancel")}{" "}</Button>
          </div>
        </div>
      )}

      {scope === "project" &&
        (syncStatus.lastCheckedAt || syncStatus.updatesAvailable.length > 0) && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {syncStatus.lastCheckedAt && (
                <span className="text-muted-foreground">
                  {t("Last synced")}{" "}{new Date(syncStatus.lastCheckedAt).toLocaleString()}
                </span>
              )}
              {syncStatus.updatesAvailable.length > 0 && (
                <Badge variant="outline" className="text-[10px] text-amber-600">
                  {syncStatus.updatesAvailable.length}{" "}
                  {t(syncStatus.updatesAvailable.length === 1 ? "skill needs" : "skills need")}{" "}
                  {t("review")}{" "}</Badge>
              )}
            </div>
            {syncStatus.lastResult &&
              (syncStatus.lastResult.added > 0 ||
                syncStatus.lastResult.updated > 0 ||
                syncStatus.lastResult.archived > 0) && (
                <p className="mt-1 text-muted-foreground">
                  {t("Last refresh:")}{" "}{syncStatus.lastResult.added} {" "}{t("added,")}{" "}
                  {syncStatus.lastResult.updated} {" "}{t("updated,")}{" "}
                  {syncStatus.lastResult.archived} {t("archived.")}{" "}</p>
              )}
          </div>
        )}

      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="font-medium">
            {problems.length === 1
              ? t("1 installed skill could not be loaded")
              : t("{v0} installed skills could not be loaded", { v0: problems.length })}
          </div>
          <p className="mt-1 text-muted-foreground">
            {t("These are on disk but their SKILL.md failed to parse, so they are hidden from the list below and from the agent. Fix the frontmatter and reopen this tab.")}{" "}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {problems.map((p) => (
              <li key={`${p.state}/${p.name}`}>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> — {p.message.split("\n")[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SettingsSearch value={query} onChange={setQuery} placeholder={t("Search skills…")} label={t("Search skills")} />

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("Loading…")}</p>
      ) : filtered.length === 0 ? (
        rows.length === 0 && scope === "project" ? (
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">
              {t("No skills installed for this project yet. The K-Dense catalogue is usually seeded on first launch; sync it now to fetch it.")}{" "}</span>
            <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={syncing} onClick={() => void refresh()}>
              {syncing ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
              {t("Sync now")}{" "}</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {rows.length === 0
              ? t("No skills installed for all projects yet. Use Add or New skill above.")
              : t("No skills match.")}
          </p>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((r) => {
            const origin = r.origin ?? "catalogue";
            const updateAvailable = syncStatus.updatesAvailable.includes(r.name);
            const orphaned = syncStatus.orphaned.includes(r.name);
            const customized = syncStatus.customized.includes(r.name);
            const rowBusy = busy?.endsWith(`:${r.name}`) ?? false;
            return (
              <div
                key={r.name}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                    <span>{r.name}</span>
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      {/* Catalogue skills from a source other than K-Dense's repo name it. */}
                      {origin === "catalogue" && r.source ? r.source : ORIGIN_LABEL[origin]}
                    </Badge>
                    {updateAvailable ? (
                      <Badge variant="outline" className="h-5 text-[10px] text-amber-600">
                        {t("Update available")}{" "}</Badge>
                    ) : orphaned ? (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {t("Removed upstream")}{" "}</Badge>
                    ) : origin === "catalogue" && customized ? (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {t("Customized")}{" "}</Badge>
                    ) : null}
                    {shadowedSet.has(r.name) && (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {scope === "global"
                          ? t("Shadowed by a project skill")
                          : t("Also installed for all projects")}
                      </Badge>
                    )}
                    {r.disableModelInvocation && (
                      <Badge variant="outline" className="h-5 text-[10px]" title={t("Hidden from the model's skills index; runs only via /skill:name")}>
                        {t("User-invoked only")}{" "}</Badge>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.description}
                  </div>
                  {r.source && origin === "registry" && (
                    <div className="truncate text-[10px] text-muted-foreground/80">
                      {r.source}
                      {r.ref ? `#${r.ref}` : ""}
                    </div>
                  )}
                </div>

                {updateAvailable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    aria-label={t("Use upstream version of {v0}", { v0: r.name })}
                    disabled={rowBusy}
                    onClick={() => void replaceWithUpstream(r)}
                  >
                    {busy === `update:${r.name}` && (
                      <Loader2Icon className="size-3 animate-spin" />
                    )}
                    {t("Use upstream")}{" "}</Button>
                )}
                {origin === "registry" && !updateAvailable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    aria-label={t("Check {v0} for updates", { v0: r.name })}
                    disabled={rowBusy}
                    onClick={() => void doCheckUpdate(r.name)}
                  >
                    {busy === `check:${r.name}` ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={t("Edit {v0}", { v0: r.name })}
                  onClick={() => void openEditor(r.name)}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={t("Remove {v0}", { v0: r.name })}
                  disabled={rowBusy}
                  onClick={() => void doRemove(r)}
                >
                  {busy === `remove:${r.name}` ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={r.disableModelInvocation ? "secondary" : "ghost"}
                  className="h-7 w-7 p-0"
                  aria-label={
                    r.disableModelInvocation
                      ? t("Let the model invoke {v0}", { v0: r.name })
                      : t("Make {v0} user-invoked only", { v0: r.name })
                  }
                  title={
                    r.disableModelInvocation
                      ? t("User-invoked only (/skill:name). Click to let the model activate it.")
                      : t("Click to hide from the model; run it yourself with /skill:name.")
                  }
                  disabled={rowBusy}
                  onClick={() =>
                    void run(`invoke:${r.name}`, async () => {
                      const next = await setSkillModelInvocation(r.name, Boolean(r.disableModelInvocation), scope);
                      return next.disableModelInvocation
                        ? t("{v0} now runs only when you type /skill:{v1}.", { v0: r.name, v1: r.name })
                        : t("{v0} can be activated by the model again.", { v0: r.name });
                    })
                  }
                >
                  <SlashIcon className="size-3.5" />
                </Button>
                <Switch
                  aria-label={t("Toggle {v0}", { v0: r.name })}
                  checked={r.enabled}
                  onCheckedChange={(v) => void toggle(r.name, v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
