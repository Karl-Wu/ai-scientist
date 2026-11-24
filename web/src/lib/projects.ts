"use client";

import { createContext, useContext } from "react";
import type { ProjectActivitySummary } from "@/lib/project-activity";
import { noteAuthFailure, withApiTokenHeader } from "@/lib/api-auth";

/**
 * Project types, storage, and the `apiFetch` wrapper used by every hook.
 *
 * The active project belongs to the browser tab. `sessionStorage` keeps it
 * across reloads, while `localStorage` supplies an initial choice to a new
 * tab. `apiFetch` injects `X-Project-Id` on every request, so individual hooks don't have
 * to know about projects at all -- they keep calling relative paths and
 * get the right project's data for free.
 *
 * When the active project changes we dispatch a window-level
 * `kady:project-changed` CustomEvent so other hooks (chat, sandbox, etc.)
 * can reset their in-memory state.
 */

export interface Project {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  spendLimitUsd: number | null;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  tags?: string[];
  id?: string;
  spendLimitUsd?: number | null;
}

export interface ProjectPatchInput {
  name?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
  spendLimitUsd?: number | null;
}

export const DEFAULT_PROJECT_ID = "default";

export const API_BASE =
  process.env.NEXT_PUBLIC_ADK_API_URL ?? "http://localhost:8000";

/**
 * Put long-lived SSE requests on a separate browser connection pool from
 * ordinary API calls. Chrome permits only six HTTP/1.1 connections per
 * origin; several background chat streams can otherwise consume all six and
 * leave interview/abort/steer requests queued indefinitely.
 *
 * localhost and 127.0.0.1 reach the same local backend but are distinct
 * origins/connection pools. Non-local deployments keep their configured URL.
 */
function streamApiBase(base: string): string {
  try {
    const url = new URL(base);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
    } else if (url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      url.hostname = "localhost";
    } else {
      return base;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
}

export const STREAM_API_BASE = streamApiBase(API_BASE);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const API_ORIGINS = new Set(
  [originOf(API_BASE), originOf(STREAM_API_BASE)].filter((o): o is string => Boolean(o)),
);

export function isApiUrl(url: string): boolean {
  // Single-port deployments use a relative API base ("/api/kady"), which has no
  // parseable origin but is still ours — the token must ride those requests too.
  if (!url.startsWith("http")) return url.startsWith(API_BASE);
  const origin = originOf(url);
  return origin !== null && API_ORIGINS.has(origin);
}

const STORAGE_KEY = "kady:activeProjectId";
const CHANGE_EVENT = "kady:project-changed";
const ProjectScopeContext = createContext<string | null>(null);
let currentTabProjectId: string | undefined;

/**
 * Pins descendants to one project even while the globally-visible project
 * changes. Used by mounted background workspaces whose streams must keep
 * talking to their owning project.
 */
export const ProjectScopeProvider = ProjectScopeContext.Provider;

export function useProjectScopeId(): string {
  return useContext(ProjectScopeContext) ?? getActiveProjectId();
}

/**
 * Read the active project id.
 *
 * Safe to call during SSR (returns the default) and from hot paths like
 * fetch wrappers. Invalid or missing values normalise to the default.
 */
export function getActiveProjectId(): string {
  if (typeof window === "undefined") return DEFAULT_PROJECT_ID;
  if (currentTabProjectId !== undefined) return currentTabProjectId;
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (saved) {
      currentTabProjectId = saved;
      return saved;
    }
  } catch {
    // This tab can still keep its selection in memory when storage is blocked.
  }
  let initial = DEFAULT_PROJECT_ID;
  try {
    initial = window.localStorage.getItem(STORAGE_KEY)?.trim() || initial;
  } catch {
    // A new tab can start at the default project without browser storage.
  }
  rememberTabProject(initial);
  return initial;
}

function rememberTabProject(id: string): void {
  currentTabProjectId = id;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The in-memory selection still works for the lifetime of the page.
  }
}

/**
 * Change this tab's project. Remember the last choice as the starting point
 * for new tabs and notify this tab's hooks.
 *
 * Fires `kady:project-changed` on `window`. No-op when called from SSR.
 */
export function setActiveProjectId(id: string): void {
  if (typeof window === "undefined") return;
  const next = id?.trim() || DEFAULT_PROJECT_ID;
  rememberTabProject(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The current tab's project does not depend on the shared preference.
  }
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: { id: next } })
  );
}

/**
 * Subscribe to active-project changes.
 *
 * Returns an unsubscribe function. Handler receives the new project id.
 */
export function onProjectChange(
  handler: (projectId: string) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (ev: Event) => {
    const id =
      (ev as CustomEvent<{ id?: string }>).detail?.id ?? getActiveProjectId();
    handler(id);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/**
 * `fetch` wrapper that prepends `API_BASE` and injects `X-Project-Id`.
 *
 * Accepts either a leading-slash path ("/projects") or a full URL. For
 * full URLs we still inject the header so cross-origin callers can pass
 * through CORS preflights without losing the scope.
 */
export function apiFetch(
  path: string,
  init: RequestInit = {},
  projectId?: string,
  lane: "default" | "stream" = "default",
): Promise<Response> {
  const base = lane === "stream" ? STREAM_API_BASE : API_BASE;
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has("X-Project-Id")) {
    headers.set("X-Project-Id", projectId?.trim() || getActiveProjectId());
  }
  // Only our backend gets the access token, never an absolute third-party URL.
  if (isApiUrl(url)) withApiTokenHeader(headers);
  return fetch(url, { ...init, headers }).then((res) => {
    noteAuthFailure(res);
    return res;
  });
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

export interface ProjectLocation { root: string; sandbox: string; uploads: string }
export async function getProjectLocation(id: string): Promise<ProjectLocation> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/location`);
  if (!res.ok) throw new Error("Could not load project location.");
  return res.json();
}
export async function openProjectFolder(id: string): Promise<void> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/open-folder`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Could not open the file manager. Copy the path from project settings.");
  }
}

export async function listProjects(): Promise<Project[]> {
  const res = await apiFetch("/projects");
  if (!res.ok) throw new Error(`listProjects ${res.status}`);
  return (await res.json()) as Project[];
}

export async function listProjectActivities(): Promise<
  Record<string, ProjectActivitySummary>
> {
  const res = await apiFetch("/projects/activity");
  if (!res.ok) throw new Error(`listProjectActivities ${res.status}`);
  const body = (await res.json()) as {
    activities?: Record<string, ProjectActivitySummary>;
  };
  return body.activities ?? {};
}

export async function createProject(
  input: ProjectCreateInput
): Promise<Project> {
  const res = await apiFetch("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `createProject ${res.status}`);
  }
  return (await res.json()) as Project;
}

export async function patchProject(
  id: string,
  input: ProjectPatchInput
): Promise<Project> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `patchProject ${res.status}`);
  }
  return (await res.json()) as Project;
}

export async function deleteProject(id: string): Promise<void> {
  // The URL identifies the target. A tab may still be scoped to a project
  // that another tab has already deleted.
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, DEFAULT_PROJECT_ID);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `HTTP ${res.status}`);
  }
}

export async function initProjectSandbox(
  id: string,
  opts: { sync_venv?: boolean; download_skills?: boolean } = {}
): Promise<void> {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(id)}/sandbox/init`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `initProjectSandbox ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Per-project context-compaction settings (stored in sandbox/.pi/settings.json)
// ---------------------------------------------------------------------------

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface CompactionSettingsResponse extends CompactionSettings {
  bounds: {
    reserveTokens: { min: number; max: number };
    keepRecentTokens: { min: number; max: number };
  };
}

export async function getProjectCompaction(id: string): Promise<CompactionSettingsResponse> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/compaction`, {}, id);
  if (!res.ok) throw new Error(`getProjectCompaction ${res.status}`);
  return (await res.json()) as CompactionSettingsResponse;
}

export async function putProjectCompaction(
  id: string,
  patch: Partial<CompactionSettings>,
): Promise<CompactionSettingsResponse> {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(id)}/compaction`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    id,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail || `putProjectCompaction ${res.status}`);
  }
  return (await res.json()) as CompactionSettingsResponse;
}

// ---------------------------------------------------------------------------
// Raw-data guard policy (stored in sandbox/.kady/policy.json)
// ---------------------------------------------------------------------------

export interface GuardPolicy {
  version: 1;
  protectedPaths: string[];
  destructiveConfirm: boolean;
}

export async function getProjectGuardPolicy(id: string): Promise<GuardPolicy> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/guard-policy`, {}, id);
  if (!res.ok) throw new Error(`getProjectGuardPolicy ${res.status}`);
  return (await res.json()) as GuardPolicy;
}

export async function putProjectGuardPolicy(
  id: string,
  patch: Partial<Pick<GuardPolicy, "protectedPaths" | "destructiveConfirm">>,
): Promise<GuardPolicy> {
  const res = await apiFetch(
    `/projects/${encodeURIComponent(id)}/guard-policy`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    id,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail || `putProjectGuardPolicy ${res.status}`);
  }
  return (await res.json()) as GuardPolicy;
}

// ---------------------------------------------------------------------------
// Sandbox AGENTS.md (the agent's project instructions)
// ---------------------------------------------------------------------------

export type InstructionsStatus = "current" | "outdated" | "edited" | "missing";

export async function getProjectInstructionsStatus(id: string): Promise<InstructionsStatus> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/instructions`, {}, id);
  if (!res.ok) throw new Error(`getProjectInstructionsStatus ${res.status}`);
  return ((await res.json()) as { status: InstructionsStatus }).status;
}

export async function restoreProjectInstructions(id: string): Promise<InstructionsStatus> {
  const res = await apiFetch(`/projects/${encodeURIComponent(id)}/instructions/restore`, { method: "POST" }, id);
  if (!res.ok) throw new Error(`restoreProjectInstructions ${res.status}`);
  return ((await res.json()) as { status: InstructionsStatus }).status;
}
