"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function ChatImage({ src, alt }: { src: string; alt: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);

  return (
    <>
      <button
        type="button"
        className="w-fit cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
        title={t("Click to enlarge")}
        aria-label={alt}
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-56 max-w-64 rounded-lg border object-contain" />
      </button>
      <Dialog open={open} onOpenChange={(value) => {
        setOpen(value);
        if (!value) setActualSize(false);
      }}>
        <DialogContent
          className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b py-2 pl-4 pr-12">
            <DialogTitle className="truncate text-sm font-medium">{t("Image preview")}</DialogTitle>
            <Button size="sm" variant="ghost" onClick={() => setActualSize((value) => !value)}>
              {actualSize ? t("Fit to window") : t("Actual size")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
            <div className={actualSize ? "flex min-h-full w-fit min-w-full items-start justify-center" : "flex h-full w-full items-center justify-center"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                className={actualSize ? "max-w-none shrink-0 self-start" : "max-h-full max-w-full object-contain"}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
