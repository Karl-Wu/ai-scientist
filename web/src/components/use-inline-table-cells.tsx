"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TableSaveResult } from "@/lib/use-sandbox";

export interface CellDraft<T> {
  snapshot: T;
  revision: string;
  cells: Map<number, Map<number, string>>;
}

export function useInlineTableCells<T>({ snapshot, revision, onSave, onDirtyChange, onSavingChange }: {
  snapshot: T;
  revision?: string;
  onSave: (draft: CellDraft<T>) => Promise<TableSaveResult>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<CellDraft<T>>();
  const [active, setActive] = useState<{ row: number; column: number; initial: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = Boolean(draft?.cells.size);
  const activeRevision = draft?.revision ?? revision;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  function changeCell(row: number, column: number, value: string, original: string) {
    setDraft((current) => {
      if (!current) return current;
      const cells = new Map(current.cells);
      const changes = new Map(cells.get(row));
      if (value === original) changes.delete(column);
      else changes.set(column, value);
      if (changes.size) cells.set(row, changes);
      else cells.delete(row);
      return { ...current, cells };
    });
    setError("");
  }

  function stopEditing() {
    setActive(undefined);
    setDraft((current) => current?.cells.size ? current : undefined);
  }

  function discard() {
    setActive(undefined);
    setDraft(undefined);
    setError("");
  }

  async function save() {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    onSavingChange?.(true);
    setError("");
    try {
      const result = await onSave(draft);
      if (result === "saved") discard();
      else if (result === "conflict") setError("The file changed on disk. Your edits are still here.");
      else if (result === "too-large") setError("The edited table exceeds the preview size limit.");
      else setError("Could not save the table. Please try again.");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Could not save the table. Please try again.");
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  function renderCell(row: number, column: number, original: string | null, label: string) {
    const changed = draft?.cells.get(row)?.get(column);
    const value = changed ?? original;
    if (active?.row === row && active.column === column) {
      return <textarea aria-label={label} autoFocus rows={value?.includes("\n") ? 3 : 1} value={value ?? ""} disabled={saving}
        className="block min-h-8 w-full resize-none bg-background px-2.5 py-1.5 leading-5 outline-none ring-2 ring-inset ring-ring"
        onChange={(event) => changeCell(row, column, event.target.value, original ?? "")}
        onBlur={stopEditing}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            changeCell(row, column, active.initial, original ?? "");
            stopEditing();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            stopEditing();
          }
        }} />;
    }
    const startEditing = () => {
      if (!activeRevision) return;
      setDraft((current) => current ?? { snapshot, revision: activeRevision, cells: new Map() });
      setActive({ row, column, initial: value ?? "" });
    };
    return <button type="button" aria-label={label} title={value ?? t("Missing value")} disabled={saving}
      className={cn("block min-h-8 w-full cursor-text px-2.5 py-1.5 text-left outline-none hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", changed !== undefined && "bg-primary/8")}
      onDoubleClick={startEditing}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          startEditing();
        }
      }}>
      <span className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{value === null ? <span className="text-muted-foreground">—</span> : value}</span>
    </button>;
  }

  const actions = <>
    <Button type="button" variant="ghost" size="xs" onClick={discard} disabled={!dirty || saving}>{t("Discard changes")}</Button>
    <Button type="button" size="xs" onClick={() => void save()} disabled={!dirty || saving}>{t(saving ? "Saving…" : "Save changes")}</Button>
  </>;
  return { draft, dirty, saving, error, renderCell, actions };
}
