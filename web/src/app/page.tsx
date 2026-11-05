"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileTreePanel } from "@/components/sandbox-panel";
import { FilePreviewPanel, SettingsDialog, WorkflowsPanel } from "@/components/lazy-surfaces";
import type { Model } from "@/components/model-selector";
import { ChatTab, type ChatTabHandle, type ChatTabMeta } from "@/components/chat-tab";
import { ChatTabsBar, type ChatTabDescriptor } from "@/components/chat-tabs-bar";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ProjectView } from "@/components/project-view";
import { SessionCostPill } from "@/components/session-cost-pill";
import { ResourceMonitor } from "@/components/resource-monitor";
import { useSessionCost } from "@/lib/use-session-cost";
import { useProjectCost } from "@/lib/use-project-cost";
import { useProjectActivities } from "@/lib/use-project-activities";
import { useModalJobs } from "@/lib/use-modal-jobs";
import { useProjects } from "@/lib/use-projects";
import { useSkills } from "@/lib/use-skills";
import { flattenFiles, flattenFolders, useSandbox } from "@/lib/use-sandbox";
import { ProjectScopeProvider } from "@/lib/projects";
import {
  hasProjectActivity,
  sameProjectActivity,
  summarizeProjectActivity,
  type ProjectActivitySummary,
} from "@/lib/project-activity";
import { onOpenSettings, type OpenSettingsRequest } from "@/lib/settings-nav";
import {
  OPEN_MODAL_JOB_EVENT,
  type ModalComputeScope,
} from "@/lib/modal-jobs";
import { isHiddenManagedSandboxFilePath, isJunkFilePath } from "@/lib/utils";
import {
  AlarmClockIcon,
  ChevronLeftIcon,
  FolderIcon,
  WorkflowIcon,
  BookOpenIcon,
  FilesIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SettingsIcon,
  ServerCogIcon,
  SunIcon,
  MoonIcon,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  deletePersistedChatState,
  loadWorkspaceSnapshot,
  pruneDeletedProjectState,
  revokeSnapshotObjectUrls,
  saveProjectWorkspaceState,
  saveWorkspaceShellState,
  type ChatWorkspaceState,
  type ProjectWorkspaceState,
  type SandboxWorkspaceState,
  type WorkspaceScreen,
} from "@/lib/workspace-persistence";
import { seedChatStateFromTab } from "@/lib/new-tab-state";
import { resolveChatTitle } from "@/lib/chat-title";
import { useAppDefaults } from "@/lib/app-settings";
import { useModels } from "@/lib/use-models";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const MAX_CHAT_TABS = 10;
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 1200;
const MIN_PROJECT_PANEL_WIDTH = 320;
type ProjectDestination = "workflows" | "files" | "notebook" | "compute" | "automation";

function maxChatWidthForViewport(): number {
  return Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, window.innerWidth - MIN_PROJECT_PANEL_WIDTH));
}

function ProjectNavigation({
  active,
  onSelect,
  orientation = "vertical",
}: {
  active: ProjectDestination | undefined;
  onSelect: (destination: ProjectDestination) => void;
  orientation?: "vertical" | "horizontal" | "sidebar";
}) {
  const horizontal = orientation === "horizontal";
  const sidebar = orientation === "sidebar";
  const items: { id: ProjectDestination; label: string; hint: string; Icon: LucideIcon; color: string }[] = [
    { id: "files", label: "Files", hint: "Browse and manage project files", Icon: FilesIcon, color: "text-blue-500" },
    { id: "workflows", label: "Workflows", hint: "Browse and launch scientific workflows", Icon: WorkflowIcon, color: "text-violet-500" },
    { id: "notebook", label: "Journal", hint: "One shared research journal for this project", Icon: BookOpenIcon, color: "text-blue-500" },
    { id: "automation", label: "Tasks", hint: "Manage scheduled tasks and ongoing missions", Icon: AlarmClockIcon, color: "text-emerald-500" },
  ];


  return (
    <nav
      aria-label="Project navigation"
      className={cn(
        sidebar ? "flex min-w-0 shrink-0 flex-col gap-1" : "flex shrink-0 bg-muted/20",
        sidebar ? "w-full" : horizontal
          ? "box-border min-h-12 w-full min-w-0 max-w-full flex-wrap items-center gap-1 overflow-x-hidden border-b px-2 py-1.5"
          : "w-[72px] flex-col gap-1 border-r p-1.5",
      )}
    >
      {items.map(({ id, label, hint, Icon, color }) => (
        <div key={id} className="contents">
        <button
          type="button"
          title={hint}
          aria-label={label}
          aria-current={active === id ? "page" : undefined}
          aria-pressed={active === id}
          onClick={() => onSelect(id)}
          className={cn(
            "shrink-0 font-medium transition-colors",
            sidebar ? "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-xs" : horizontal
              ? "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs"
              : "flex h-[54px] w-full flex-col items-center justify-center gap-1 rounded-lg px-1 text-[8px] leading-none",
            active === id
              ? (sidebar ? "bg-muted text-foreground" : "bg-background text-foreground shadow-sm ring-1 ring-border")
              : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
        >
          <Icon className={cn("shrink-0", horizontal ? "size-3.5" : "size-4", color)} />
          <span className="whitespace-nowrap">{label}</span>
        </button>
        </div>
      ))}
    </nav>
  );
}

/**
 * Sent by the sandbox "Auto-organize files" wand. Moving a data file silently
 * breaks every script that read it by relative path, so the prompt makes the
 * agent plan first, never delete, and fix references it moved out from under.
 */
const ORGANIZE_FILES_PROMPT =
  "Organize the files in the sandbox into a clear folder structure (for example raw data, scripts, figures, results, notebooks). " +
  "First list the moves you intend to make, then carry them out. Do not delete anything, and leave dotfiles, config, lock files, and virtual environments in place. " +
  "After moving, update relative paths in any scripts, notebooks, or documents that referenced the moved files, and finish with a short summary of what moved where.";

interface ChatTabEntry {
  id: string;
  title: string;
  titleIsCustom?: boolean;
  /** Stored session reopened into this tab (History menu), if any. */
  sessionId?: string;
}

/** Stable id for the first tab so SSR and hydration match. */
const INITIAL_TAB_ID = "tab-initial";

function makeTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTabTitle(index: number): string {
  return `Chat ${index + 1}`;
}

// Thin drag handle between two panels
function ResizeHandle({
  onPointerDown,
  orientation = "vertical",
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  orientation?: "vertical" | "horizontal";
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "group relative z-10 flex shrink-0 touch-none items-center justify-center bg-transparent",
        vertical ? "w-2 cursor-col-resize" : "h-2 w-full cursor-row-resize",
      )}
      onPointerDown={onPointerDown}
    >
      <div className={cn(
        "absolute bg-border transition-colors group-hover:bg-blue-400 group-active:bg-blue-500",
        vertical ? "inset-y-0 w-px" : "inset-x-0 h-px",
      )} />
      <div className={cn(
        "relative rounded-full bg-muted-foreground/25 transition-colors group-hover:bg-blue-400",
        vertical ? "h-8 w-0.5" : "h-0.5 w-8",
      )} />
    </div>
  );
}

export default function HomePage() {
  const [screen, setScreen] = useState<WorkspaceScreen>("projects");
  const [openedProjectIds, setOpenedProjectIds] = useState<string[]>([]);
  const [restoredProjects, setRestoredProjects] = useState<
    Record<string, ProjectWorkspaceState>
  >({});
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [projectDirectoryHydrated, setProjectDirectoryHydrated] = useState(false);
  const [projectActivities, setProjectActivities] = useState<
    Record<string, ProjectActivitySummary>
  >({});
  const {
    activeProjectId,
    projects,
    loading: projectsLoading,
    error: projectsError,
  } = useProjects();
  const serverProjectActivities = useProjectActivities(
    workspaceHydrated && screen === "projects",
  );
  const displayedProjectActivities = useMemo(
    () => ({ ...serverProjectActivities, ...projectActivities }),
    [projectActivities, serverProjectActivities],
  );

  useEffect(() => {
    if (!projectsLoading) setProjectDirectoryHydrated(true);
  }, [projectsLoading]);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceSnapshot().then((snapshot) => {
      if (cancelled) {
        // Nothing will consume (or revoke) the restored attachment blob URLs.
        revokeSnapshotObjectUrls(snapshot);
        return;
      }
      setRestoredProjects(snapshot.projects);
      // Always start in the project overview. A project's saved workspace is
      // restored lazily only after the user chooses that project.
      setWorkspaceHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberProject = useCallback((projectId: string) => {
    setOpenedProjectIds((prev) => (
      prev.includes(projectId) ? prev : [...prev, projectId]
    ));
  }, []);

  const openProject = useCallback((projectId: string) => {
    rememberProject(projectId);
    setScreen("workspace");
  }, [rememberProject]);

  const handleProjectActivityChange = useCallback(
    (projectId: string, activity: ProjectActivitySummary) => {
      setProjectActivities((prev) => {
        const existing = prev[projectId];
        if (!hasProjectActivity(activity)) {
          if (!existing) return prev;
          const next = { ...prev };
          delete next[projectId];
          return next;
        }
        if (sameProjectActivity(existing, activity)) return prev;
        return { ...prev, [projectId]: activity };
      });
    },
    [],
  );

  // ProjectSwitcher changes the global selection from inside the currently
  // visible workspace. Mount the destination workspace without unmounting the
  // source, so any live SSE stream in the source keeps running.
  useEffect(() => {
    if (workspaceHydrated && screen === "workspace") rememberProject(activeProjectId);
  }, [activeProjectId, rememberProject, screen, workspaceHydrated]);

  // A deleted project must release its mounted workspace and persisted shell
  // state. The DELETE endpoint explicitly aborts its server-owned runs first;
  // this unmount only disconnects browser-side event observers.
  useEffect(() => {
    if (projectsLoading || !workspaceHydrated) return;
    // A failed or empty list is not "every project was deleted". On a fetch
    // error `projects` keeps its initial [] with loading=false, and the server
    // always has at least the default project, so pruning against an empty
    // set would wipe every project's persisted workspace on a backend blip.
    if (projectsError || projects.length === 0) return;
    const existing = new Set(projects.map((project) => project.id));
    setOpenedProjectIds((prev) => {
      const next = prev.filter((id) => existing.has(id));
      return next.length === prev.length ? prev : next;
    });
    setProjectActivities((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([id]) => existing.has(id)),
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setRestoredProjects((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([id]) => existing.has(id)),
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    void pruneDeletedProjectState(existing);
  }, [projects, projectsError, projectsLoading, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const timer = window.setTimeout(() => {
      void saveWorkspaceShellState(screen, openedProjectIds);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [openedProjectIds, screen, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const flush = () => {
      void saveWorkspaceShellState(screen, openedProjectIds);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [openedProjectIds, screen, workspaceHydrated]);

  return (
    <>
      <div
        className={screen === "projects" ? "contents" : "hidden"}
        aria-hidden={screen !== "projects"}
      >
        <ProjectView
          isActive={screen === "projects"}
          onOpenProject={openProject}
          projectActivities={displayedProjectActivities}
        />
      </div>
      {projectDirectoryHydrated && openedProjectIds.map((projectId) => {
        const isActive = screen === "workspace" && projectId === activeProjectId;
        return (
          <ProjectScopeProvider key={projectId} value={projectId}>
            <div className={isActive ? "contents" : "hidden"} aria-hidden={!isActive}>
              <WorkspacePage
                projectId={projectId}
                isActive={isActive}
                hydrated={workspaceHydrated}
                initialState={restoredProjects[projectId]}
                onProjectActivityChange={handleProjectActivityChange}
                onOpenProjectView={() => setScreen("projects")}
              />
            </div>
          </ProjectScopeProvider>
        );
      })}
    </>
  );
}

function WorkspacePage({
  projectId,
  isActive,
  hydrated,
  initialState,
  onProjectActivityChange,
  onOpenProjectView,
}: {
  projectId: string;
  isActive: boolean;
  hydrated: boolean;
  initialState?: ProjectWorkspaceState;
  onProjectActivityChange: (
    projectId: string,
    activity: ProjectActivitySummary,
  ) => void;
  onOpenProjectView: () => void;
}) {
  const [sandboxWorkspace, setSandboxWorkspace] = useState<SandboxWorkspaceState>(
    () => initialState?.sandbox ?? { openPaths: [], activePath: null },
  );
  const handleSandboxWorkspaceChange = useCallback((next: SandboxWorkspaceState) => {
    setSandboxWorkspace((current) =>
      current.activePath === next.activePath &&
      current.openPaths.length === next.openPaths.length &&
      current.openPaths.every((path, index) => path === next.openPaths[index])
        ? current
        : next,
    );
  }, []);
  const sandbox = useSandbox(
    isActive,
    undefined,
    initialState?.sandbox,
    handleSandboxWorkspaceChange,
  );
  const { skills: allSkills, loading: skillsLoading } = useSkills();
  const appDefaults = useAppDefaults();
  const { models: newChatModels } = useModels();
  const newChatDefaultModel = useRef<Model | undefined>(undefined);
  newChatDefaultModel.current = newChatModels.find((model) => model.id === appDefaults?.model);
  const { projects: projectDirectory } = useProjects();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(
    () => initialState?.sandboxOpen ?? true,
  );
  const [chatNavigationOpen, setChatNavigationOpen] = useState(
    () => initialState?.chatOpen ?? true,
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(
    () => initialState?.rightPanelOpen ?? true,
  );
  const [narrowProjectLayout, setNarrowProjectLayout] = useState(false);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setNarrowProjectLayout(media.matches);
      setFileDrawerOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const openFileList = useCallback(() => {
    if (narrowProjectLayout) setFileDrawerOpen(true);
    else setSandboxOpen(true);
  }, [narrowProjectLayout]);
  const closeFileList = useCallback(() => {
    if (narrowProjectLayout) setFileDrawerOpen(false);
    else setSandboxOpen(false);
  }, [narrowProjectLayout]);
  const toggleChatNavigation = useCallback(
    () => setChatNavigationOpen((value) => !value),
    [],
  );
  const toggleRightPanel = useCallback(
    () => setRightPanelOpen((value) => !value),
    [],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequest, setSettingsRequest] = useState<OpenSettingsRequest | null>(null);
  const [showNotebook, setShowNotebook] = useState(
    () => initialState?.showNotebook ?? false,
  );
  const [showAutomation, setShowAutomation] = useState(
    () => initialState?.showAutomation ?? false,
  );
  const [showCompute, setShowCompute] = useState(
    () => initialState?.showCompute ?? false,
  );
  const [view, setView] = useState<"chat" | "workflows">(
    () => initialState?.view ?? "chat",
  );
  const activeProjectDestination: ProjectDestination = view === "workflows"
    ? "workflows"
    : showNotebook
    ? "notebook"
    : showCompute
      ? "compute"
      : showAutomation
        ? "automation"
        : "files";
  const filesOnRight = activeProjectDestination === "files";
  const showFileTree = filesOnRight && (narrowProjectLayout ? fileDrawerOpen : sandboxOpen);
  const selectProjectDestination = useCallback((destination: ProjectDestination) => {
    setView(destination === "workflows" ? "workflows" : "chat");
    setShowNotebook(destination === "notebook");
    setShowCompute(destination === "compute");
    setShowAutomation(destination === "automation");
  }, []);
  const [computeScope, setComputeScope] = useState<ModalComputeScope>(
    () => initialState?.computeScope ?? "project",
  );

  // Chat tab management. We allocate the initial id once via useRef so it
  // stays stable across React's strict-mode double-invocation of
  // useState's lazy initializer (which would otherwise mint two different
  // ids — one for the tabs array and one for activeTabId).
  const initialTabId = INITIAL_TAB_ID;
  const [tabs, setTabs] = useState<ChatTabEntry[]>(() =>
    initialState?.tabs.length
      ? initialState.tabs.map(({ id, title, titleIsCustom, sessionId }) => ({ id, title, titleIsCustom, sessionId }))
      : [{ id: initialTabId, title: defaultTabTitle(0) }],
  );
  const [activeTabId, setActiveTabId] = useState<string>(
    () => initialState?.activeTabId ?? initialTabId,
  );
  const [tabWorkspaceStates, setTabWorkspaceStates] = useState<
    Record<string, ChatWorkspaceState>
  >(() =>
    Object.fromEntries(
      (initialState?.tabs ?? []).flatMap((tab) =>
        tab.chat ? [[tab.id, tab.chat] as const] : [],
      ),
    ),
  );
  // Mirror of tabs in a ref so synchronous handlers can read length without
  // putting impure logic inside a setState updater (which strict mode runs
  // twice for purity testing).
  const tabsRef = useRef(tabs);
  // Same ref trick for what newTab seeds a fresh tab from; both change often
  // and neither should re-create the callback.
  const tabWorkspaceStatesRef = useRef(tabWorkspaceStates);
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    tabWorkspaceStatesRef.current = tabWorkspaceStates;
  }, [tabWorkspaceStates]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Per-tab agent meta, populated by each <ChatTab> via onMetaChange. We
  // read from this to drive the cost pill and tab
  // strip badges (streaming spinner, message count) for the active tab.
  const [tabsMeta, setTabsMeta] = useState<Record<string, ChatTabMeta>>({});
  const tabHandles = useRef<Map<string, ChatTabHandle | null>>(new Map());
  // Stable per-tab ref callbacks so React doesn't repeatedly clear+set the
  // tab handle map on every render (inline `ref={(h) => ...}` would).
  const tabRefCallbacks = useRef<
    Map<string, (handle: ChatTabHandle | null) => void>
  >(new Map());
  const getTabRefCallback = useCallback(
    (id: string) => {
      let cb = tabRefCallbacks.current.get(id);
      if (!cb) {
        cb = (handle: ChatTabHandle | null) => {
          if (handle) tabHandles.current.set(id, handle);
          else tabHandles.current.delete(id);
        };
        tabRefCallbacks.current.set(id, cb);
      }
      return cb;
    },
    [],
  );

  // Bumped whenever any chat tab finishes a turn, so the cost pill (which
  // tracks the active tab's session) refetches.
  const [costRefreshKey, setCostRefreshKey] = useState(0);

  const handleMetaChange = useCallback(
    (tabId: string, meta: ChatTabMeta) => {
      if (meta.sessionId || meta.suggestedTitle) {
        setTabs((current) => {
          if (!current.some((tab) => tab.id === tabId && (
            (meta.sessionId && tab.sessionId !== meta.sessionId) ||
            resolveChatTitle(tab.title, meta.suggestedTitle, tab.titleIsCustom) !== tab.title
          ))) {
            return current;
          }
          return current.map((tab) =>
            tab.id === tabId
              ? { ...tab, title: resolveChatTitle(tab.title, meta.suggestedTitle, tab.titleIsCustom), sessionId: meta.sessionId ?? tab.sessionId }
              : tab,
          );
        });
      }
      setTabsMeta((prev) => {
        const existing = prev[tabId];
        // Token deltas stay local to ChatTab. Only workspace-visible state
        // crosses this boundary; notebook-only updates must still propagate.
        if (
          existing &&
          existing.sessionId === meta.sessionId &&
          existing.status === meta.status &&
          existing.runState === meta.runState &&
          existing.isStreaming === meta.isStreaming &&
          existing.userMessageCount === meta.userMessageCount &&
          existing.needsInput === meta.needsInput &&
          existing.notebookEntries === meta.notebookEntries &&
          existing.subagentCompletions === meta.subagentCompletions
        ) {
          return prev;
        }
        return { ...prev, [tabId]: meta };
      });
    },
    [],
  );

  const handleTabWorkspaceStateChange = useCallback(
    (tabId: string, state: ChatWorkspaceState) => {
      setTabWorkspaceStates((current) =>
        current[tabId] === state ? current : { ...current, [tabId]: state },
      );
    },
    [],
  );

  const handleTurnComplete = useCallback(() => {
    setCostRefreshKey((k) => k + 1);
  }, []);

  // Pull out the two sandbox functions we re-trigger on turn completion.
  // Destructuring keeps the deps stable below — useSandbox returns a new
  // object literal each render, so depending on `sandbox` directly would
  // make `handleSandboxRefresh` change identity every render.
  const {
    fetchTree: sandboxFetchTree,
    refreshOpenTabs: sandboxRefreshOpenTabs,
    selectFile: sandboxSelectFile,
  } = sandbox;
  const handleSandboxRefresh = useCallback(() => {
    sandboxFetchTree();
    sandboxRefreshOpenTabs();
  }, [sandboxFetchTree, sandboxRefreshOpenTabs]);

  useEffect(() => setMounted(true), []);

  // Drive sandbox polling cadence off the active tab's streaming state
  // (the live-poll mode used to be hard-wired to the single chat).
  const activeMeta = tabsMeta[activeTabId];
  const notebookEntries = activeMeta?.notebookEntries ?? [];
  const notebookStreaming = activeMeta?.isStreaming ?? false;
  const subagentCompletions = activeMeta?.subagentCompletions ?? 0;
  const anyStreaming = useMemo(
    () => Object.values(tabsMeta).some((m) => m.isStreaming),
    [tabsMeta],
  );
  // While any tab is streaming, poll the active sandbox more aggressively so
  // the file tree + open previews update as the agent writes files. Hidden
  // projects keep their SSE streams mounted but catch up when reopened.
  useEffect(() => {
    if (!isActive || !anyStreaming) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) await Promise.all([sandboxFetchTree(), sandboxRefreshOpenTabs()]);
      if (!cancelled) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [anyStreaming, isActive, sandboxFetchTree, sandboxRefreshOpenTabs]);

  const [treeWidth, setTreeWidth] = useState(
    () => initialState?.treeWidth ?? 320,
  );
  const [chatWidth, setChatWidth] = useState(
    () => initialState?.chatWidth ?? 640,
  );
  const [mobileProjectHeight, setMobileProjectHeight] = useState(
    () => initialState?.mobileProjectHeight ?? 36,
  );
  const [mobileFilesHeight, setMobileFilesHeight] = useState(
    () => initialState?.mobileFilesHeight ?? 50,
  );
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;
  const [chatNavWidth, setChatNavWidth] = useState(
    () => initialState?.chatNavWidth ?? 136,
  );
  // Keep a useful slice of the conversation pane visible even when the whole
  // chat column has been resized to its minimum width.
  const visibleChatNavWidth = Math.min(
    chatNavWidth,
    Math.max(96, Math.min(360, chatWidth - 168)),
  );
  const [isResizing, setIsResizing] = useState(false);
  const dragging = useRef<"tree" | "chat" | "chat-nav" | "mobile-project" | "mobile-files" | null>(null);
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragStartWidth = useRef(0);
  const dragStartProjectHeight = useRef(36);
  const dragStartFilesHeight = useRef(50);
  const dragStartProjectContentHeight = useRef(1);

  const startDrag = useCallback((panel: "tree" | "chat" | "chat-nav" | "mobile-project" | "mobile-files") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = panel;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    if (panel === "mobile-project") {
      dragStartProjectHeight.current = mobileProjectHeight;
    } else if (panel === "mobile-files") {
      dragStartFilesHeight.current = mobileFilesHeight;
      dragStartProjectContentHeight.current = Math.max(
        1,
        e.currentTarget.parentElement?.parentElement?.clientHeight ?? 1,
      );
    } else {
      dragStartWidth.current = panel === "tree"
        ? treeWidth
        : panel === "chat"
          ? chatWidth
          : visibleChatNavWidth;
    }
    setIsResizing(true);
  }, [treeWidth, chatWidth, visibleChatNavWidth, mobileProjectHeight, mobileFilesHeight]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - dragStartX.current;
      if (dragging.current === "mobile-project") {
        const viewportHeight = Math.max(1, window.innerHeight);
        const deltaVh = ((e.clientY - dragStartY.current) / viewportHeight) * 100;
        const maxVh = Math.max(24, Math.min(70, ((viewportHeight - 190) / viewportHeight) * 100));
        setMobileProjectHeight(Math.max(24, Math.min(maxVh, dragStartProjectHeight.current - deltaVh)));
        return;
      }
      if (dragging.current === "mobile-files") {
        const deltaPercent = ((e.clientY - dragStartY.current) / dragStartProjectContentHeight.current) * 100;
        setMobileFilesHeight(Math.max(25, Math.min(75, dragStartFilesHeight.current + deltaPercent)));
        return;
      }
      if (dragging.current === "tree") {
        // The file tree is now on the right of the preview, so dragging its
        // divider right makes the tree narrower.
        setTreeWidth(Math.max(150, Math.min(480, dragStartWidth.current - delta)));
      } else {
        // Both chat panes are on the left of their dividers, so dragging right
        // makes the selected pane wider.
        if (dragging.current === "chat") {
          setChatWidth(Math.max(MIN_CHAT_WIDTH, Math.min(maxChatWidthForViewport(), dragStartWidth.current + delta)));
        } else {
          const maxWidth = Math.max(96, Math.min(360, chatWidthRef.current - 168));
          setChatNavWidth(Math.max(96, Math.min(maxWidth, dragStartWidth.current + delta)));
        }
      }
    };
    const onUp = () => {
      dragging.current = null;
      setIsResizing(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  const projectWorkspaceState = useMemo<ProjectWorkspaceState>(
    () => ({
      tabs: tabs.map((tab) => ({
        ...tab,
        ...(tabWorkspaceStates[tab.id]
          ? { chat: tabWorkspaceStates[tab.id] }
          : {}),
      })),
      activeTabId,
      view,
      showNotebook,
      showCompute,
      showAutomation,
      computeScope,
      rightPanelOpen,
      sandboxOpen,
      chatOpen: chatNavigationOpen,
      treeWidth,
      chatWidth,
      chatNavWidth,
      mobileProjectHeight,
      mobileFilesHeight,
      sandbox: sandboxWorkspace,
    }),
    [
      activeTabId,
      chatNavigationOpen,
      chatNavWidth,
      chatWidth,
      mobileProjectHeight,
      mobileFilesHeight,
      computeScope,
      rightPanelOpen,
      sandboxOpen,
      sandboxWorkspace,
      showAutomation,
      showCompute,
      showNotebook,
      tabWorkspaceStates,
      tabs,
      treeWidth,
      view,
    ],
  );
  const projectWorkspaceStateRef = useRef(projectWorkspaceState);
  projectWorkspaceStateRef.current = projectWorkspaceState;

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void saveProjectWorkspaceState(projectId, projectWorkspaceState);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [hydrated, projectId, projectWorkspaceState]);

  useEffect(() => {
    if (!hydrated) return;
    const flush = () => {
      void saveProjectWorkspaceState(projectId, projectWorkspaceStateRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [hydrated, projectId]);

  // Deep links into Settings ("raise the limit in project settings", …).
  useEffect(() => {
    if (!isActive) return;
    return onOpenSettings((request) => {
      setSettingsRequest(request);
      setSettingsOpen(true);
    });
  }, [isActive]);

  // Flat list of all sandbox file paths for @ mentions (shared across tabs).
  // Cache artifacts are excluded — mentioning __pycache__/*.pyc is never useful.
  const allFiles = useMemo(
    () => flattenFiles(sandbox.tree).filter((p) => !isJunkFilePath(p) && !isHiddenManagedSandboxFilePath(p)),
    [sandbox.tree],
  );
  const allFolders = useMemo(
    () => flattenFolders(sandbox.tree).filter((p) => !isJunkFilePath(p)),
    [sandbox.tree],
  );

  // ------------------------------------------------------------------
  // Tab management callbacks
  // ------------------------------------------------------------------

  const newTab = useCallback(() => {
    // Mint the id OUTSIDE any setState updater. Strict mode invokes
    // updaters twice for purity testing, which would otherwise produce
    // two different ids on a single click — the array would commit one
    // id while setActiveTabId got the other, leaving every tab with
    // isActive=false and display:none.
    if (tabsRef.current.length >= MAX_CHAT_TABS) return;
    const id = makeTabId();
    // Honor the saved default model; inherit thinking/compute and, when no
    // default model is configured, the active tab's model. Drafts,
    // attachments, and queued prompts stay with the tab they belong to.
    const seeded = seedChatStateFromTab(
      tabWorkspaceStatesRef.current[activeTabIdRef.current],
      newChatDefaultModel.current,
    );
    if (seeded) {
      setTabWorkspaceStates((prev) => ({ ...prev, [id]: seeded }));
    }
    setTabs((prev) =>
      prev.length >= MAX_CHAT_TABS
        ? prev
        : [...prev, { id, title: defaultTabTitle(prev.length) }],
    );
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    // Abort an in-flight stream so the agent doesn't keep running into a
    // detached component. Safe to call on a non-streaming tab too.
    tabHandles.current.get(id)?.stop();
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((curr) => {
        if (curr !== id) return curr;
        const fallback = next[Math.min(idx, next.length - 1)];
        return fallback?.id ?? next[0].id;
      });
      return next;
    });
    tabHandles.current.delete(id);
    tabRefCallbacks.current.delete(id);
    setTabsMeta((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    setTabWorkspaceStates((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    void deletePersistedChatState(projectId, id);
  }, [projectId]);

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title, titleIsCustom: true } : t)),
    );
  }, []);

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  // A tab whose stored session no longer exists on disk: keep the tab, drop the
  // binding, so it stops being treated as that session (dedupe, History focus)
  // and stops re-requesting it on every reload.
  const forgetTabSession = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id || !t.sessionId) return t;
        const { sessionId: _dropped, ...rest } = t;
        void _dropped;
        return rest;
      }),
    );
  }, []);

  // Reopen a stored session (History menu). If some tab already holds that
  // session, just focus it — two tabs must never share one session.
  const openSession = useCallback(
    (sessionId: string, title: string) => {
      // Check the tab descriptors as well as reported meta: a restored or
      // just-opened tab carries its sessionId before its ChatTab has mounted
      // and reported meta, and matching on meta alone let the same session be
      // opened into a second tab.
      const openTabId =
        tabsRef.current.find((t) => t.sessionId === sessionId)?.id ??
        Object.entries(tabsMeta).find(([, meta]) => meta.sessionId === sessionId)?.[0];
      if (openTabId) {
        setActiveTabId(openTabId);
        return;
      }
      if (tabsRef.current.length >= MAX_CHAT_TABS) return;
      const id = makeTabId();
      setTabs((prev) =>
        prev.length >= MAX_CHAT_TABS ? prev : [...prev, { id, title, sessionId }],
      );
      setActiveTabId(id);
    },
    [tabsMeta],
  );

  // ------------------------------------------------------------------
  // Workflow launch — routes to the active chat tab via its imperative
  // handle while keeping the workflow catalogue open.
  // ------------------------------------------------------------------

  const handleWorkflowLaunch = useCallback(
    async (prompt: string, model: Model, inputFiles: string[]) => {
      const handle = tabHandles.current.get(activeTabId);
      if (!handle || activeMeta?.isStreaming) return;
      await handle.launchWorkflow(prompt, model, inputFiles);
    },
    [activeTabId, activeMeta?.isStreaming],
  );

  const handleFileSelect = useCallback((path: string) => {
    sandboxSelectFile(path);
    setView("chat");
    setShowNotebook(false);
    setShowCompute(false);
    setShowAutomation(false);
  }, [sandboxSelectFile]);
  const handleOrganizeFiles = useCallback(() => {
    const handle = tabHandles.current.get(activeTabId);
    if (!handle) return;
    void handle.sendQuick(ORGANIZE_FILES_PROMPT);
  }, [activeTabId]);

  // ------------------------------------------------------------------
  // Chat ↔ notebook deep links (join key: tool-call id === entry id).
  // ------------------------------------------------------------------
  const [notebookFocus, setNotebookFocus] = useState<{ id: string; token: number } | null>(null);
  const handleViewInNotebook = useCallback((entryId: string) => {
    setView("chat");
    setShowCompute(false);
    setShowAutomation(false);
    setShowNotebook(true);
    setNotebookFocus({ id: entryId, token: Date.now() });
  }, []);
  const [computeFocus, setComputeFocus] = useState<{ id: string; token: number } | null>(null);
  const handleViewCompute = useCallback((jobId?: string) => {
    setView("chat");
    setShowNotebook(false);
    setShowAutomation(false);
    setShowCompute(true);
    if (jobId) setComputeFocus({ id: jobId, token: Date.now() });
  }, []);
  useEffect(() => {
    if (!isActive) return;
    const onOpenJob = (event: Event) => {
      const jobId = (
        event as CustomEvent<{ jobId?: string }>
      ).detail?.jobId;
      handleViewCompute(jobId);
    };
    window.addEventListener(OPEN_MODAL_JOB_EVENT, onOpenJob);
    return () => window.removeEventListener(OPEN_MODAL_JOB_EVENT, onOpenJob);
  }, [handleViewCompute, isActive]);
  const handleNotebookJumpToChat = useCallback(
    (entryId: string) => {
      // Un-hide the chat column without toggling it closed, then scroll once
      // display:none has lifted (scrollIntoView no-ops on hidden elements).
      setChatNavigationOpen(true);
      setTimeout(() => {
        const ok = tabHandles.current.get(activeTabId)?.scrollToToolCall(entryId) ?? false;
        if (!ok) toast.error("Couldn't find this entry in the chat transcript.");
      }, 50);
    },
    [activeTabId],
  );

  // ------------------------------------------------------------------
  // Header pieces — cost pill — read from the active tab.
  // ------------------------------------------------------------------

  const activeSessionId = activeMeta?.sessionId ?? null;
  // A jump targets the chat it came from; a notebook view remounting under
  // another chat must not replay it ("That notebook entry isn't in this chat").
  useEffect(() => { setNotebookFocus(null); }, [activeSessionId]);
  const {
    activeCount: activeModalJobCount,
    loading: modalJobsLoading,
  } = useModalJobs({ projectId, enabled: isActive, limit: 200 });

  // Async subagents are ledgered when the child finishes, which can be long
  // after the parent turn ended. Without this the pill under-reported spend
  // until the next turn.
  const totalSubagentCompletions = useMemo(
    () =>
      Object.values(tabsMeta).reduce(
        (sum, meta) => sum + (meta.subagentCompletions ?? 0),
        0,
      ),
    [tabsMeta],
  );
  useEffect(() => {
    if (totalSubagentCompletions === 0) return;
    setCostRefreshKey((k) => k + 1);
  }, [totalSubagentCompletions]);

  const { summary: costSummary, loading: costLoading } = useSessionCost(
    activeSessionId,
    costRefreshKey,
  );
  const { summary: projectCost, loading: projectCostLoading } =
    useProjectCost(costRefreshKey);
  const directorySpendLimit = projectDirectory.find(
    (project) => project.id === projectId,
  )?.spendLimitUsd;
  // Match the server's admission rule: it compares *committed* money (ledgered
  // + compute reservations + in-flight runs) against the cap, and treats a
  // non-positive limit as unlimited.
  const committedUsd = projectCost.budget.committedUsd ?? projectCost.budget.totalUsd;
  const budgetBlocked =
    directorySpendLimit === undefined
      ? projectCost.budget.state === "exceeded"
      : directorySpendLimit !== null &&
        directorySpendLimit > 0 &&
        committedUsd >= directorySpendLimit;
  const projectActivity = useMemo(
    () =>
      summarizeProjectActivity(
        Object.values(tabsMeta).map((meta) => ({
          isStreaming: meta.isStreaming,
          runState: meta.runState,
          needsInput: meta.needsInput,
        })),
        budgetBlocked,
      ),
    [budgetBlocked, tabsMeta],
  );

  useEffect(() => {
    onProjectActivityChange(projectId, projectActivity);
  }, [onProjectActivityChange, projectActivity, projectId]);

  const tabDescriptors: ChatTabDescriptor[] = useMemo(
    () =>
      tabs.map((t) => ({
        id: t.id,
        title: t.title,
        titleIsCustom: t.titleIsCustom,
        isStreaming: tabsMeta[t.id]?.isStreaming ?? false,
        userMessageCount: tabsMeta[t.id]?.userMessageCount ?? 0,
        sessionId: tabsMeta[t.id]?.sessionId ?? t.sessionId ?? null,
      })),
    [tabs, tabsMeta],
  );

  const projectFilesPanel = (
    <FileTreePanel
      tree={sandbox.tree}
      selectedPath={sandbox.activeTabPath}
      uploading={sandbox.uploading}
      onSelect={(path) => {
        handleFileSelect(path);
        if (narrowProjectLayout) setFileDrawerOpen(false);
      }}
      onDownload={sandbox.downloadFile}
      onDelete={sandbox.deleteFile}
      onDownloadDir={sandbox.downloadDir}
      onDeleteDir={sandbox.deleteDir}
      onDownloadAll={sandbox.downloadAll}
      onRefresh={sandbox.fetchTree}
      onClose={closeFileList}
      onUpload={sandbox.uploadFiles}
      onOrganize={handleOrganizeFiles}
      onMove={sandbox.moveItem}
      onRename={sandbox.renameItem}
      onCreateDir={sandbox.createDir}
    />
  );

  return (
    <div className="flex h-dvh min-w-0 flex-col">
      {/* Header */}
      <header className="relative flex flex-wrap items-center justify-between gap-2 border-b px-3 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenProjectView}
            aria-label="Back to projects"
            className="flex items-start gap-2"
          >
            {/* Plain <img> to avoid Next/Image's aspect-ratio warning when we
                set height via CSS and let width autosize. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/ai-scientist.svg?v=2"
              alt="AI Scientist"
              className="size-7 object-contain"
            />
            <span className="flex flex-col items-start pt-0.5">
              <span className="text-sm font-semibold leading-4 tracking-tight text-foreground/80">AI Scientist</span>
              <span className="mt-0.5 whitespace-nowrap text-[9px] leading-3 text-muted-foreground/70">Powered by DeepWorks</span>
            </span>
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
          <ProjectSwitcher onOpenProjectView={onOpenProjectView} />
        </div>
        <p className="absolute left-1/2 hidden -translate-x-1/2 text-[11px] text-muted-foreground/60 tracking-wide select-none 2xl:block">
          A research workspace for scientists and biologists
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isActive && <ResourceMonitor />}
          <SessionCostPill
            summary={costSummary}
            projectSummary={projectCost}
            limitUsd={projectCost.limitUsd}
            loading={costLoading || projectCostLoading}
          />
          {activeModalJobCount > 0 ? (
            <InfoTooltip
              content={`${activeModalJobCount} Modal compute job${
                activeModalJobCount === 1 ? " is" : "s are"
              } still running. Open Compute to inspect live logs.`}
            >
              <button
                type="button"
                onClick={() => handleViewCompute()}
                aria-label={`Open Compute, ${activeModalJobCount} active jobs`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-500/15 dark:text-violet-300"
              >
                <ServerCogIcon className="size-3.5" />
                <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />
                {activeModalJobCount}
              </button>
            </InfoTooltip>
          ) : modalJobsLoading ? (
            <span className="sr-only" aria-live="polite">Checking compute jobs</span>
          ) : null}
          {/* The left navigation and right project panel collapse independently. */}
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
            <InfoTooltip
              content={
                <>
                  <b>{chatNavigationOpen ? "Hide" : "Show"} left navigation</b>
                  <br />
                  Show or hide New chat, Recent chats, and Workflows.
                </>
              }
            >
              <button
                onClick={toggleChatNavigation}
                aria-label={chatNavigationOpen ? "Hide left navigation" : "Show left navigation"}
                aria-pressed={chatNavigationOpen}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  chatNavigationOpen
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <PanelLeftIcon className="size-4" />
              </button>
            </InfoTooltip>
            <InfoTooltip
              content={
                <>
                  <b>{rightPanelOpen ? "Hide" : "Show"} right panel</b>
                  <br />
                  Show or hide Files, Workflows, Journal, and Tasks.
                </>
              }
            >
              <button
                onClick={toggleRightPanel}
                aria-label={rightPanelOpen ? "Hide right panel" : "Show right panel"}
                aria-pressed={rightPanelOpen}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  rightPanelOpen
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <PanelRightIcon className="size-4" />
              </button>
            </InfoTooltip>
          </div>
          <InfoTooltip
            content={
              <>
                <b>Settings</b>
                <br />
                Model providers and defaults, this project&apos;s budget, skills and
                specialists, and services like web search and Modal.
              </>
            }
          >
            <button
              onClick={() => {
                setSettingsRequest(null);
                setSettingsOpen(true);
              }}
              aria-label="Open settings"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SettingsIcon className="size-4" />
            </button>
          </InfoTooltip>
          {mounted && (
            <InfoTooltip
              content={
                resolvedTheme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                aria-label={
                  resolvedTheme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {resolvedTheme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
              </button>
            </InfoTooltip>
          )}
        </div>
      </header>

      {/* Main content area — narrow windows stack the chat above a compact
          project panel, while desktop keeps the resizable side-by-side layout. */}
      <div
        className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row", isResizing && "select-none")}
      >

        {/* The content area: its navigation spans the preview and file tree. */}
        <div className={cn(
          "order-3 min-h-0 min-w-0 flex-col overflow-hidden lg:order-3 lg:flex-1",
          rightPanelOpen
            ? "flex h-[var(--mobile-project-height)] flex-none lg:h-auto"
            : "hidden",
        )} style={{ "--mobile-project-height": `${mobileProjectHeight}dvh` } as CSSProperties}>
          {isActive && !chatNavigationOpen && (
            <ProjectNavigation
              active={activeProjectDestination}
              onSelect={selectProjectDestination}
              orientation="horizontal"
            />
          )}
          <div data-project-content-panels className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {view === "workflows" && (
                <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
                  <WorkflowsPanel
                    onLaunch={handleWorkflowLaunch}
                    onUploadFiles={sandbox.uploadFiles}
                    availableFiles={allFiles}
                    availableFolders={allFolders}
                    filesReady={sandbox.tree !== null}
                    onRefreshFiles={sandbox.fetchTree}
                    chatRunning={activeMeta?.isStreaming ?? false}
                    budgetBlocked={projectCost.budget.state === "exceeded"}
                  />
                </div>
              )}
              <div className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", view === "workflows" && "hidden")}>
              <FilePreviewPanel
                projectId={projectId}
                isActive={isActive}
                activeModelRef={tabWorkspaceStates[activeTabId]?.selectedModel.id}
                tabs={sandbox.tabs}
                activeTabPath={sandbox.activeTabPath}
                onTabSelect={handleFileSelect}
                onTabClose={sandbox.closeTab}
                onDownload={sandbox.downloadFile}
                onSaveText={sandbox.saveFile}
                onSaveImageBlob={sandbox.saveImageBlob}
                onRetry={sandbox.retryFile}
                onCompileLatex={sandbox.compileLatex}
                showNotebook={showNotebook}
                onSelectNotebook={() => selectProjectDestination("notebook")}
                showCompute={showCompute}
                onSelectCompute={() => selectProjectDestination("compute")}
                showAutomation={showAutomation}
                onSelectAutomation={() => selectProjectDestination("automation")}
                fileTreeVisible={showFileTree}
                onShowFileTree={openFileList}
                computeSessionId={activeSessionId}
                computeScope={computeScope}
                onComputeScopeChange={setComputeScope}
                computeFocus={computeFocus}
                onOpenComputeOutput={handleFileSelect}
                notebookSessionId={activeSessionId}
                notebookEntries={notebookEntries}
                notebookStreaming={notebookStreaming}
                notebookSubagentCompletions={subagentCompletions}
                onOpenNotebookFile={handleFileSelect}
                notebookFocus={notebookFocus}
                onNotebookJumpToChat={handleNotebookJumpToChat}
                onOpenNotebookEntry={handleViewInNotebook}
              />
              </div>
            </div>
            {isActive && filesOnRight && !showFileTree && (
              <div className="flex w-9 shrink-0 items-start justify-center border-l bg-muted/10 pt-2">
                <button
                  type="button"
                  onClick={openFileList}
                  aria-label="Show file list"
                  aria-expanded={false}
                  title="Show file list"
                  className="flex flex-col items-center gap-1 rounded-l-md border border-r-0 bg-background px-1 py-2 text-blue-500 shadow-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <FolderIcon className="size-4" />
                  <ChevronLeftIcon className="size-3" />
                </button>
              </div>
            )}
            {isActive && filesOnRight && showFileTree && !narrowProjectLayout && (
              <>
                <div className="-mr-1 flex">
                  <ResizeHandle onPointerDown={startDrag("tree")} />
                </div>
                <div
                  className="flex min-h-0 min-w-0 flex-none shrink-0 flex-col overflow-hidden w-[min(var(--tree-width),30vw)]"
                  style={{ "--tree-width": `${treeWidth}px` } as CSSProperties}
                >
                  {projectFilesPanel}
                </div>
              </>
            )}
            {isActive && filesOnRight && narrowProjectLayout && (
              <Dialog open={fileDrawerOpen} onOpenChange={setFileDrawerOpen}>
                <DialogContent
                  showCloseButton={false}
                  aria-describedby={undefined}
                  className="inset-y-0 left-auto right-0 top-0 flex h-dvh w-[360px] max-w-[90vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[90vw]"
                >
                  <DialogTitle className="sr-only">Project files</DialogTitle>
                  {projectFilesPanel}
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {isActive && rightPanelOpen && (
          <div className="order-2 lg:hidden">
            <ResizeHandle orientation="horizontal" onPointerDown={startDrag("mobile-project")} />
          </div>
        )}

        {/* Drag handle: preview ↔ chat */}
        {isActive && rightPanelOpen && (
          <div className="-mr-1 hidden lg:order-2 lg:flex">
            <ResizeHandle onPointerDown={startDrag("chat")} />
          </div>
        )}

        {/* Chat / workflows. The conversation pane is always present; only
            its navigation rail can be collapsed. */}
        <div
          className={cn(
            "relative order-1 flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden lg:order-1 lg:flex-none lg:shrink-0",
            rightPanelOpen ? "lg:w-[var(--chat-width)]" : "lg:w-full",
            "lg:order-1",
          )}
          style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
        >

          {chatNavigationOpen && (
            <ChatTabsBar
              projectId={projectId}
              width={visibleChatNavWidth}
              workspaceNavigation={
                <ProjectNavigation
                  active={rightPanelOpen ? activeProjectDestination : undefined}
                  onSelect={(destination) => {
                    selectProjectDestination(destination);
                    setRightPanelOpen(true);
                  }}
                  orientation="sidebar"
                />
              }
              tabs={tabDescriptors}
              activeTabId={activeTabId}
              maxTabs={MAX_CHAT_TABS}
              onSelect={selectTab}
              onClose={closeTab}
              onNew={newTab}
              onRename={renameTab}
              onOpenSession={openSession}
              activeSessionId={activeSessionId}
              canExport={(activeMeta?.userMessageCount ?? 0) > 0}
            />
          )}
          {chatNavigationOpen && isActive && (
            <div className="-mr-1 hidden lg:flex">
              <ResizeHandle onPointerDown={startDrag("chat-nav")} />
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Chat tabs — all kept mounted so background streams continue.
                Each ChatTab hides itself with `display: none` when inactive. */}
            {tabs.map((t) => (
              <ChatTab
                key={t.id}
                ref={getTabRefCallback(t.id)}
                projectId={projectId}
                tabId={t.id}
                initialSessionId={t.sessionId ?? null}
                initialWorkspaceState={tabWorkspaceStates[t.id]}
                isActive={isActive && t.id === activeTabId}
                isActiveTab={isActive && t.id === activeTabId}
                allFiles={allFiles}
                sandboxReady={sandbox.tree !== null}
                uploadFiles={sandbox.uploadFiles}
                onSandboxRefresh={handleSandboxRefresh}
                onTurnComplete={handleTurnComplete}
                allSkills={allSkills}
                skillsReady={!skillsLoading}
                budgetState={projectCost.budget.state}
                budgetTotalUsd={projectCost.budget.totalUsd}
                budgetLimitUsd={projectCost.budget.limitUsd}
                onMetaChange={handleMetaChange}
                onWorkspaceStateChange={handleTabWorkspaceStateChange}
                onSessionUnavailable={forgetTabSession}
                onViewInNotebook={handleViewInNotebook}
                onViewCompute={handleViewCompute}
                onOpenFile={handleFileSelect}
              />
            ))}


          </div>
        </div>

      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} request={settingsRequest} />
    </div>
  );
}
