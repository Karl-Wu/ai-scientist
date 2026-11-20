"use client";

import { useSyncExternalStore } from "react";

const storageKey = "kady:showReasoningDetails";
const changeEvent = "kady:reasoning-display-changed";
let unsavedPreference: boolean | undefined;

function readPreference() {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useShowReasoningDetails() {
  return useSyncExternalStore(subscribe, readPreference, () => false);
}

export function setShowReasoningDetails(show: boolean) {
  try {
    window.localStorage.setItem(storageKey, String(show));
    unsavedPreference = undefined;
  } catch {
    // The preference remains available for the current page.
    unsavedPreference = show;
  }
  window.dispatchEvent(new Event(changeEvent));
}
