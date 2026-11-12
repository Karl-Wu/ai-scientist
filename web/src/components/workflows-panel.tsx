"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  AtomIcon,
  BarChart3Icon,
  BinaryIcon,
  BookOpenIcon,
  BoxIcon,
  BrainIcon,
  BuildingIcon,
  CalculatorIcon,
  CircleDotIcon,
  ClipboardCheckIcon,
  CloudIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CogIcon,
  CpuIcon,
  CrosshairIcon,
  DatabaseIcon,
  DnaIcon,
  DollarSignIcon,
  DropletIcon,
  EyeIcon,
  FileCheck2Icon,
  FileSearchIcon,
  FileTextIcon,
  FilterIcon,
  FingerprintIcon,
  FlameIcon,
  FlaskConicalIcon,
  GaugeIcon,
  GemIcon,
  GitBranchIcon,
  GitCompareIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  HeartPulseIcon,
  HexagonIcon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  LeafIcon,
  LineChartIcon,
  ListChecksIcon,
  MapIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MicroscopeIcon,
  MountainIcon,
  NetworkIcon,
  NewspaperIcon,
  PaletteIcon,
  PencilIcon,
  PieChartIcon,
  PlayIcon,
  PresentationIcon,
  RefreshCwIcon,
  ReplyIcon,
  RocketIcon,
  RouteIcon,
  RssIcon,
  SatelliteIcon,
  ScaleIcon,
  ScanIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  SigmaIcon,
  SparklesIcon,
  SproutIcon,
  StarIcon,
  StethoscopeIcon,
  TargetIcon,
  TelescopeIcon,
  ThermometerIcon,
  TimerIcon,
  TreePineIcon,
  TrendingUpIcon,
  UsersIcon,
  WavesIcon,
  WindIcon,
  WrenchIcon,
  WorkflowIcon as WorkflowsIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ModelSelector,
  type Model,
  DEFAULT_MODEL,
  modelUsesBillableBudget,
} from "@/components/model-selector";
import { useModels } from "@/lib/use-models";
import workflowsData from "@/data/workflows.json";
import { useAppDefaults } from "@/lib/app-settings";
import { WorkflowInputs, type WorkflowInputProps } from "@/components/workflow-inputs";
import { buildWorkflowPrompt } from "@/lib/workflow-inputs";
import { LanguageSelector } from "@/components/language-selector";
import { useI18n, useT } from "@/components/i18n-provider";
import type { Locale } from "@/lib/i18n";
import workflowLocaleZh from "@/data/workflow-locales/zh-CN.json";

export type Workflow = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  prompt: string;
  placeholders: { key: string; label: string; required: boolean }[];
  requiresFiles: boolean;
};

const ALL_WORKFLOWS = workflowsData as Workflow[];
const ZH_WORKFLOW_LOCALE = workflowLocaleZh as {
  categories: Record<string, string>;
  workflows: Record<string, string[]>;
};

function localizedCategoryLabel(category: { id: string; label: string }, locale: Locale) {
  return locale === "zh-CN" ? ZH_WORKFLOW_LOCALE.categories[category.id] ?? category.label : category.label;
}

function localizedWorkflow(workflow: Workflow, locale: Locale): Workflow {
  if (locale !== "zh-CN") return workflow;
  const translation = ZH_WORKFLOW_LOCALE.workflows[workflow.id];
  return translation ? { ...workflow, name: translation[0], description: translation[1] } : workflow;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Activity: ActivityIcon,
  Atom: AtomIcon,
  BarChart3: BarChart3Icon,
  Binary: BinaryIcon,
  BookOpen: BookOpenIcon,
  Box: BoxIcon,
  Brain: BrainIcon,
  Building: BuildingIcon,
  Calculator: CalculatorIcon,
  CircleDot: CircleDotIcon,
  ClipboardCheck: ClipboardCheckIcon,
  Cloud: CloudIcon,
  Cog: CogIcon,
  Cpu: CpuIcon,
  Crosshair: CrosshairIcon,
  Database: DatabaseIcon,
  Dna: DnaIcon,
  DollarSign: DollarSignIcon,
  Droplet: DropletIcon,
  Eye: EyeIcon,
  FileCheck: FileCheck2Icon,
  FileSearch: FileSearchIcon,
  FileText: FileTextIcon,
  Filter: FilterIcon,
  Fingerprint: FingerprintIcon,
  Flame: FlameIcon,
  FlaskConical: FlaskConicalIcon,
  Gauge: GaugeIcon,
  Gem: GemIcon,
  GitBranch: GitBranchIcon,
  GitCompare: GitCompareIcon,
  Globe: GlobeIcon,
  GraduationCap: GraduationCapIcon,
  Heart: HeartIcon,
  HeartPulse: HeartPulseIcon,
  Hexagon: HexagonIcon,
  Image: ImageIcon,
  Layers: LayersIcon,
  LayoutGrid: LayoutGridIcon,
  Leaf: LeafIcon,
  LineChart: LineChartIcon,
  ListChecks: ListChecksIcon,
  Map: MapIcon,
  Megaphone: MegaphoneIcon,
  MessageCircle: MessageCircleIcon,
  Microscope: MicroscopeIcon,
  Mountain: MountainIcon,
  Network: NetworkIcon,
  Newspaper: NewspaperIcon,
  Palette: PaletteIcon,
  Pencil: PencilIcon,
  PieChart: PieChartIcon,
  Presentation: PresentationIcon,
  RefreshCw: RefreshCwIcon,
  Reply: ReplyIcon,
  Rocket: RocketIcon,
  Route: RouteIcon,
  Rss: RssIcon,
  Satellite: SatelliteIcon,
  Scale: ScaleIcon,
  Scan: ScanIcon,
  Search: SearchIcon,
  Send: SendIcon,
  Shield: ShieldIcon,
  Sigma: SigmaIcon,
  Sparkles: SparklesIcon,
  Sprout: SproutIcon,
  Star: StarIcon,
  Stethoscope: StethoscopeIcon,
  Target: TargetIcon,
  Telescope: TelescopeIcon,
  Thermometer: ThermometerIcon,
  Timer: TimerIcon,
  TreePine: TreePineIcon,
  TrendingUp: TrendingUpIcon,
  Users: UsersIcon,
  Waves: WavesIcon,
  Wind: WindIcon,
  Wrench: WrenchIcon,
  Zap: ZapIcon,
};

const CATEGORIES: { id: string; label: string; color: string }[] = [
  { id: "paper", label: "Paper & Manuscript", color: "text-blue-500" },
  { id: "visual", label: "Visual & Presentation", color: "text-rose-500" },
  { id: "data", label: "Data & Analysis", color: "text-emerald-500" },
  { id: "literature", label: "Literature & Research", color: "text-violet-500" },
  { id: "scicomm", label: "Science Communication", color: "text-cyan-500" },
  { id: "genomics", label: "Genomics & Transcriptomics", color: "text-teal-500" },
  { id: "proteomics", label: "Proteomics & Structural Biology", color: "text-indigo-500" },
  { id: "cellbio", label: "Cell Biology & Single-Cell", color: "text-fuchsia-500" },
  { id: "drugdiscovery", label: "Drug Discovery & Pharmacology", color: "text-red-500" },
  { id: "clinical", label: "Clinical & Health Sciences", color: "text-green-500" },
  { id: "social", label: "Social Sciences", color: "text-pink-500" },
  { id: "ml", label: "Machine Learning & AI", color: "text-blue-600" },
  { id: "engineering", label: "Engineering & Simulation", color: "text-zinc-500" },
];

const CATEGORY_BG: Record<string, string> = {
  paper: "bg-blue-500/10 hover:bg-blue-500/15 border-blue-500/20",
  visual: "bg-rose-500/10 hover:bg-rose-500/15 border-rose-500/20",
  data: "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20",
  literature: "bg-violet-500/10 hover:bg-violet-500/15 border-violet-500/20",
  scicomm: "bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/20",
  genomics: "bg-teal-500/10 hover:bg-teal-500/15 border-teal-500/20",
  proteomics: "bg-indigo-500/10 hover:bg-indigo-500/15 border-indigo-500/20",
  cellbio: "bg-fuchsia-500/10 hover:bg-fuchsia-500/15 border-fuchsia-500/20",
  drugdiscovery: "bg-red-500/10 hover:bg-red-500/15 border-red-500/20",
  clinical: "bg-green-500/10 hover:bg-green-500/15 border-green-500/20",
  social: "bg-pink-500/10 hover:bg-pink-500/15 border-pink-500/20",
  ml: "bg-blue-600/10 hover:bg-blue-600/15 border-blue-600/20",
  engineering: "bg-zinc-500/10 hover:bg-zinc-500/15 border-zinc-500/20",
};

const CATEGORY_ICON_COLOR: Record<string, string> = {
  paper: "text-blue-500",
  visual: "text-rose-500",
  data: "text-emerald-500",
  literature: "text-violet-500",
  scicomm: "text-cyan-500",
  genomics: "text-teal-500",
  proteomics: "text-indigo-500",
  cellbio: "text-fuchsia-500",
  drugdiscovery: "text-red-500",
  clinical: "text-green-500",
  social: "text-pink-500",
  ml: "text-blue-600",
  engineering: "text-zinc-500",
};

function WorkflowIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? FileTextIcon;
  return <Icon className={className} />;
}

export function WorkflowLaunchDialog({
  workflow,
  open,
  onOpenChange,
  onLaunch,
  onUploadFiles,
  availableFiles,
  availableFolders,
  filesReady,
  onRefreshFiles,
  budgetBlocked = false,
  chatRunning = false,
}: {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunch: (prompt: string, model: Model, inputFiles: string[]) => void;
  budgetBlocked?: boolean;
  chatRunning?: boolean;
} & WorkflowInputProps) {
  const t = useT();
  const { locale } = useI18n();
  const [model, setModel] = useState<Model>(DEFAULT_MODEL);
  const { modelAvailability, models: knownModels } = useModels();
  // Start from Settings → Defaults until the user picks a model here.
  const appDefaults = useAppDefaults();
  const modelTouched = useRef(false);
  useEffect(() => {
    if (modelTouched.current || !appDefaults?.model) return;
    const preferred = knownModels.find((candidate) => candidate.id === appDefaults.model);
    if (preferred) setModel(preferred);
  }, [appDefaults, knownModels]);
  const selectedModelAvailability = modelAvailability(model);
  const modelAvailable = selectedModelAvailability === "available";
  const selectedBudgetBlocked =
    budgetBlocked && modelUsesBillableBudget(model);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [inputFiles, setInputFiles] = useState<string[]>([]);
  const [inputFolders, setInputFolders] = useState<string[]>([]);
  const [sources, setSources] = useState("");
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);

  const updatePlaceholder = useCallback((key: string, value: string) => {
    setPlaceholderValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const assembledPrompt = useMemo(() => {
    let prompt = workflow.prompt;
    for (const ph of workflow.placeholders) {
      const val = placeholderValues[ph.key]?.trim() || `[${ph.label}]`;
      prompt = prompt.replaceAll(`{${ph.key}}`, val);
    }
    return prompt;
  }, [workflow, placeholderValues]);

  const canLaunch = workflow.placeholders
    .filter((ph) => ph.required)
    .every((ph) => placeholderValues[ph.key]?.trim());

  const finalPrompt = buildWorkflowPrompt(editedPrompt ?? assembledPrompt, inputFiles, sources, inputFolders);

  const handleLaunch = useCallback(() => {
    if (chatRunning || uploading || !canLaunch || selectedBudgetBlocked || !modelAvailable) return;
    onLaunch(finalPrompt, model, inputFiles);
    onOpenChange(false);
    setPlaceholderValues({});
    setInputFiles([]);
    setInputFolders([]);
    setSources("");
    setEditedPrompt(null);
    setIsEditingPrompt(false);
  }, [finalPrompt, model, inputFiles, onLaunch, onOpenChange, chatRunning, uploading, canLaunch, selectedBudgetBlocked, modelAvailable]);

  const iconColor = CATEGORY_ICON_COLOR[workflow.category] ?? "text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WorkflowIcon name={workflow.icon} className={cn("size-5", iconColor)} />
            {workflow.name}
          </DialogTitle>
          <DialogDescription>{workflow.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium">{workflow.requiresFiles ? t("Workflow data") : "Workflow data (optional)"}</p>
            <WorkflowInputs
              availableFiles={availableFiles}
              availableFolders={availableFolders}
              filesReady={filesReady}
              onRefreshFiles={onRefreshFiles}
              onUploadFiles={onUploadFiles}
              files={inputFiles}
              onFilesChange={setInputFiles}
              folders={inputFolders}
              onFoldersChange={setInputFolders}
              sources={sources}
              onSourcesChange={setSources}
              uploading={uploading}
              onUploadingChange={setUploading}
            />
          </div>

          {workflow.placeholders.length > 0 && (
            <div className="space-y-3">
              {workflow.placeholders.map((ph) => (
                <div key={ph.key}>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {ph.label}
                    {ph.required && <span className="ml-0.5 text-destructive">*</span>}
                  </label>
                  <input
                    type="text"
                    value={placeholderValues[ph.key] ?? ""}
                    onChange={(e) => updatePlaceholder(ph.key, e.target.value)}
                    placeholder={ph.label}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/50"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                {isEditingPrompt ? "Edit prompt" : t("Prompt preview")}
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!isEditingPrompt) {
                    setEditedPrompt(editedPrompt ?? assembledPrompt);
                  }
                  setIsEditingPrompt(!isEditingPrompt);
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PencilIcon className="size-3" />
                {isEditingPrompt ? t("Done") : t("Edit")}
              </button>
            </div>
            {isEditingPrompt ? (
              <textarea
                value={editedPrompt ?? assembledPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="max-h-48 min-h-[5rem] w-full resize-y rounded-lg border bg-background px-3 py-2 text-xs leading-relaxed outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            ) : (
              <div className="max-h-32 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {finalPrompt}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              selected={model}
              excludeFusion
              onChange={(next) => {
                modelTouched.current = true;
                setModel(next);
              }}
            />
          </div>
        </div>

        {chatRunning && (
          <p role="status" className="text-sm text-muted-foreground">
            {locale === "zh-CN"
              ? "当前会话正在运行。请等待完成，或新建会话后启动工作流。"
              : "This chat is running. Wait for it to finish or start a new chat before launching a workflow."}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}</Button>
          <Button
            onClick={handleLaunch}
            disabled={chatRunning || uploading || !canLaunch || selectedBudgetBlocked || !modelAvailable}
            title={
              !modelAvailable
                ? selectedModelAvailability === "checking"
                  ? "Model provider status is still loading."
                  : "This model provider is disconnected. Reconnect it in Settings → Providers or choose another model."
                : selectedBudgetBlocked
                ? "Project spend limit reached. Raise the limit in Settings → Project → General to continue."
                : undefined
            }
            className="gap-1.5"
          >
            <PlayIcon className="size-3.5" />
            {t("Run workflow")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowsPanel({
  onLaunch,
  onUploadFiles,
  availableFiles,
  availableFolders,
  filesReady,
  onRefreshFiles,
  budgetBlocked = false,
  chatRunning = false,
}: {
  onLaunch: (prompt: string, model: Model, inputFiles: string[]) => void;
  budgetBlocked?: boolean;
  chatRunning?: boolean;
} & WorkflowInputProps) {
  const t = useT();
  const { locale } = useI18n();
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryNavRef = useRef<HTMLDivElement>(null);
  const [categoryScroll, setCategoryScroll] = useState({ left: false, right: false });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return ALL_WORKFLOWS;
    return ALL_WORKFLOWS.filter((w) => {
      const localized = localizedWorkflow(w, locale);
      const category = CATEGORIES.find((candidate) => candidate.id === w.category);
      return (
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q) ||
        localized.name.toLowerCase().includes(q) ||
        localized.description.toLowerCase().includes(q) ||
        (category ? localizedCategoryLabel(category, locale).toLowerCase().includes(q) : false)
      );
    });
  }, [search, locale]);

  const grouped = useMemo(() => {
    const map = new Map<string, Workflow[]>();
    for (const cat of CATEGORIES) map.set(cat.id, []);
    for (const w of filtered) {
      const list = map.get(w.category);
      if (list) list.push(w);
    }
    return map;
  }, [filtered]);

  const visibleCategories = useMemo(
    () => CATEGORIES.filter((cat) => (grouped.get(cat.id)?.length ?? 0) > 0),
    [grouped]
  );

  const scrollToCategory = useCallback((catId: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const section = container.querySelector(`[data-category="${catId}"]`);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const updateCategoryScroll = useCallback(() => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    setCategoryScroll({
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    updateCategoryScroll();
    const observer = new ResizeObserver(updateCategoryScroll);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [updateCategoryScroll, visibleCategories.length, locale]);

  const nudgeCategories = useCallback((direction: -1 | 1) => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    nav.scrollBy({ left: direction * Math.max(180, nav.clientWidth * 0.65), behavior: "smooth" });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <WorkflowsIcon className="size-4 shrink-0 text-violet-500" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t("Workflows")}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("{count} workflows · {categories} categories", {
                count: ALL_WORKFLOWS.length,
                categories: CATEGORIES.length,
              })}
            </p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-xl flex-1 basis-72 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search workflows...")}
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary placeholder:text-muted-foreground/50"
            />
          </div>
          <LanguageSelector />
        </div>
      </header>
      {/* Category pills */}
      <div className="shrink-0 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {(categoryScroll.left || categoryScroll.right) && (
            <button
              type="button"
              aria-label={t("Scroll categories left")}
              title={t("Previous categories")}
              disabled={!categoryScroll.left}
              onClick={() => nudgeCategories(-1)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
          )}
          <div
            ref={categoryNavRef}
            onScroll={updateCategoryScroll}
            aria-label={t("Workflow categories")}
            className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 scrollbar-none"
          >
            {visibleCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  CATEGORY_BG[cat.id]
                )}
              >
                <span className={CATEGORY_ICON_COLOR[cat.id]}>{localizedCategoryLabel(cat, locale)}</span>
              </button>
            ))}
          </div>
          {(categoryScroll.left || categoryScroll.right) && (
            <button
              type="button"
              aria-label={t("Scroll categories right")}
              title={t("More categories")}
              disabled={!categoryScroll.right}
              onClick={() => nudgeCategories(1)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable workflow grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-6">
          {CATEGORIES.map((cat) => {
            const workflows = grouped.get(cat.id);
            if (!workflows || workflows.length === 0) return null;
            return (
              <section key={cat.id} data-category={cat.id}>
                <h3 className={cn("mb-2.5 text-xs font-semibold uppercase tracking-wider", cat.color)}>
                  {localizedCategoryLabel(cat, locale)}
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                    ({workflows.length})
                  </span>
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-2">
                  {workflows.map((w) => {
                    const bgClass = CATEGORY_BG[w.category] ?? "";
                    const iconColor = CATEGORY_ICON_COLOR[w.category] ?? "text-muted-foreground";
                    return (
                      <button
                        key={w.id}
                        onClick={() => setSelectedWorkflow(w)}
                        className={cn(
                          "flex min-w-0 items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all",
                          bgClass
                        )}
                      >
                        <WorkflowIcon name={w.icon} className={cn("mt-0.5 size-4 shrink-0", iconColor)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <span className="text-sm font-medium text-foreground">{localizedWorkflow(w, locale).name}</span>
                            {w.requiresFiles && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                <DatabaseIcon className="size-2.5" />
                                {t("Needs user data")}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed line-clamp-1">
                            {localizedWorkflow(w, locale).description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {selectedWorkflow && (
        <WorkflowLaunchDialog
          workflow={localizedWorkflow(selectedWorkflow, locale)}
          open={!!selectedWorkflow}
          onOpenChange={(open) => {
            if (!open) setSelectedWorkflow(null);
          }}
          onLaunch={onLaunch}
          onUploadFiles={onUploadFiles}
          availableFiles={availableFiles}
          availableFolders={availableFolders}
          filesReady={filesReady}
          onRefreshFiles={onRefreshFiles}
          budgetBlocked={budgetBlocked}
          chatRunning={chatRunning}
        />
      )}
    </div>
  );
}
