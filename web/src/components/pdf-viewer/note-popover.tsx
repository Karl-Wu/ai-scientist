"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { type Author, colorForAuthor } from "@/lib/pdf-annotations";
import { cn } from "@/lib/utils";

export interface NotePopoverProps {
  screen: { x: number; y: number };
  initialBody: string;
  author: Author;
  showDelete?: boolean;
  isExpert?: boolean;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (body: string) => void;
  onDelete?: (force: boolean) => void;
  onCreateNote?: (body: string) => void;
}

export function NotePopover({
  screen,
  initialBody,
  author,
  showDelete,
  isExpert,
  saving = false,
  error,
  onCancel,
  onSave,
  onDelete,
  onCreateNote,
}: NotePopoverProps) {
  const t = useT();
  const [body, setBody] = useState(initialBody);
  const ref = useRef<HTMLDivElement>(null);
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    if (saving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.altKey) setAltHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setAltHeld(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [onCancel, saving]);

  // Position the popover near the click; clamp to viewport.
  const height = (onCreateNote ? 250 : 220) + (error ? 32 : 0);
  const top = Math.max(8, Math.min(screen.y + 8, (typeof window !== "undefined" ? window.innerHeight : 800) - height));
  const left = Math.min(
    Math.max(screen.x + 8, 8),
    (typeof window !== "undefined" ? window.innerWidth : 1200) - 320,
  );

  const readOnly = Boolean(isExpert);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto fixed z-50 w-[300px] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ top, left }}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: colorForAuthor(author) }}
        />
        <span className="font-medium">{author.label}</span>
        <span className="text-muted-foreground">
          {author.kind === "expert" ? "· expert" : "· you"}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        readOnly={readOnly}
        disabled={saving}
        placeholder={readOnly ? "" : "Add a note…"}
        className={cn(
          "h-24 w-full resize-none rounded border bg-background p-2 text-sm",
          readOnly && "cursor-default text-muted-foreground",
        )}
      />
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {showDelete && onDelete && (
            <button
              type="button"
              disabled={saving || (isExpert && !altHeld)}
              onClick={() => onDelete(altHeld || !isExpert)}
              title={
                isExpert
                  ? "Hold Alt and click to delete an expert annotation"
                  : "Delete annotation"
              }
              className={cn(
                "rounded px-2 py-1 text-xs",
                isExpert && !altHeld
                  ? "cursor-not-allowed text-muted-foreground/50"
                  : "text-destructive hover:bg-destructive/10",
              )}
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          {!readOnly && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(body)}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          )}
        </div>
      </div>
      {onCreateNote && (
        <button
          type="button"
          disabled={saving}
          onClick={() => onCreateNote(body)}
          className="mt-2 w-full rounded border px-2 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {t("Create note from this annotation")}
        </button>
      )}
    </div>
  );
}
