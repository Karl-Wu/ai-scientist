"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

/** Text-only recall: it never resends, reattaches files or changes context chips. */
export function useInputHistory(history: string[], setInput: (text: string) => void) {
  const cursor = useRef<{ index: number; draft: string; recalled: string } | null>(null);
  const reset = useCallback(() => { cursor.current = null; }, []);
  const key = JSON.stringify(history);
  useEffect(reset, [key, reset]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    const input = event.currentTarget;
    if (input.selectionStart !== input.selectionEnd || !history.length) return false;
    if (cursor.current && cursor.current.recalled !== input.value) reset();
    let current = cursor.current;
    if (!current) {
      // Enter history only from the first line; other arrows move the caret.
      if (event.key !== 'ArrowUp' || input.value.slice(0, input.selectionStart).includes('\n')) return false;
      current = { index: history.length, draft: input.value, recalled: input.value };
    }
    const index = Math.max(0, Math.min(history.length, current.index + (event.key === 'ArrowUp' ? -1 : 1)));
    const text = index === history.length ? current.draft : history[index];
    event.preventDefault();
    cursor.current = index === history.length ? null : { ...current, index, recalled: text };
    setInput(text);
    requestAnimationFrame(() => {
      if (input.isConnected && input.value === text) input.setSelectionRange(text.length, text.length);
    });
    return true;
  }, [history, setInput, reset]);
  return { onKeyDown, reset };
}
