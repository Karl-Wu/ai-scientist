"use client";

import { useEffect, useMemo, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useT } from "@/components/i18n-provider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { splitComposerContext } from "@/lib/composer-context";
import type { ChatMessage } from "@/lib/use-agent";
import { cn } from "@/lib/utils";

/** One user prompt and all assistant continuations until the next prompt. */
export function conversationTurns(messages: ChatMessage[]) {
  const turns: { id: string; prompt: string; answer: string }[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ id: message.id, prompt: splitComposerContext(message.content).text.trim(), answer: "" });
    } else if (message.role === "assistant" && turns.length) {
      const turn = turns[turns.length - 1];
      // Prefer the latest response in a turn, usually its final answer.
      if (message.content.trim()) turn.answer = message.content.trim().slice(0, 500);
    }
  }
  return turns;
}

export function ConversationMap({ messages }: { messages: ChatMessage[] }) {
  const t = useT();
  const turns = useMemo(() => conversationTurns(messages), [messages]);
  const { scrollRef, contentRef, stopScroll } = useStickToBottomContext();
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content || turns.length < 2) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchors = Array.from(content.querySelectorAll<HTMLElement>("[data-chat-user-id]"));
        const top = scroll.getBoundingClientRect().top + 48;
        let current = anchors[0]?.dataset.chatUserId;
        for (const anchor of anchors) {
          if (anchor.getBoundingClientRect().top > top) break;
          current = anchor.dataset.chatUserId;
        }
        if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4) current = turns.at(-1)?.id;
        setActive(current);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(content);
    scroll.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", update);
    };
  }, [turns, scrollRef, contentRef]);

  if (turns.length < 2) return null;
  const jump = (id: string) => {
    const scroll = scrollRef.current;
    const anchor = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-chat-user-id]") ?? [])
      .find((node) => node.dataset.chatUserId === id);
    if (!scroll || !anchor) return;
    stopScroll();
    const top = scroll.scrollTop + anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16;
    scroll.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return (
    <TooltipProvider delayDuration={150}>
      <nav aria-label={t("Conversation map")} className="absolute bottom-6 left-[2px] top-6 z-10 hidden w-4 flex-col justify-center @min-[640px]/chat:flex">
        <div className="flex max-h-full min-h-0 flex-col overflow-y-auto [scrollbar-width:none]">
          {turns.map((turn, index) => (
            <Tooltip key={turn.id}>
              <TooltipTrigger asChild>
                <button type="button" aria-label={t("Go to turn {number}: {prompt}", { number: index + 1, prompt: turn.prompt.slice(0, 80) || t("Image or attachment") })}
                  aria-current={active === turn.id ? "step" : undefined}
                  onClick={() => jump(turn.id)}
                  className="group flex h-[10px] min-h-1 shrink items-center justify-center p-0 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={cn("size-[5px] shrink-0 rounded-full bg-muted-foreground/30 transition-[transform,background-color] group-hover:scale-200 group-hover:bg-foreground/70 group-focus-visible:scale-200 group-focus-visible:bg-foreground/70", active === turn.id && "bg-foreground")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" align="center" sideOffset={12} className="w-80 max-w-[calc(100vw-6rem)] rounded-xl border bg-popover p-4 text-left text-popover-foreground shadow-lg [&_svg]:hidden">
                <p className="mb-1 text-xs text-muted-foreground">{t("Turn {number}", { number: index + 1 })}</p>
                <p className="line-clamp-2 break-words text-sm font-medium">{turn.prompt || t("Image or attachment")}</p>
                <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">{turn.answer || t("No response yet")}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
