"use client";

import type { ComponentProps } from "react";

import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MicIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export type SpeechInputMode = "detecting" | "speech-recognition" | "none";

export type SpeechInputProps = ComponentProps<typeof Button> & {
  onTranscriptionChange?: (text: string) => void;
  onModeChange?: (mode: SpeechInputMode) => void;
  onSpeechError?: (message: string) => void;
  /** A BCP 47 tag for browser recognition. */
  lang?: string;
};

function speechRecognitionErrorMessage(error: string): string | null {
  switch (error) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow microphone access and try again.";
    case "audio-capture":
      return "No microphone is available.";
    case "network":
      return "Speech recognition could not reach its service.";
    case "language-not-supported":
      return "This browser does not support the current dictation language.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return "Dictation could not be started.";
  }
}

export const SpeechInput = ({
  className,
  onTranscriptionChange,
  onModeChange,
  onSpeechError,
  lang = "en-US",
  disabled: disabledProp,
  onPointerDown: onPointerDownProp,
  onPointerUp: onPointerUpProp,
  onPointerCancel: onPointerCancelProp,
  onKeyDown: onKeyDownProp,
  onKeyUp: onKeyUpProp,
  ...buttonProps
}: SpeechInputProps) => {
  const t = useT();
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [mode, setMode] = useState<SpeechInputMode>("detecting");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isHoldingRef = useRef(false);
  const onTranscriptionChangeRef = useRef<
    SpeechInputProps["onTranscriptionChange"]
  >(onTranscriptionChange);
  const onErrorRef =
    useRef<SpeechInputProps["onSpeechError"]>(onSpeechError);

  // Keep refs in sync
  onTranscriptionChangeRef.current = onTranscriptionChange;
  onErrorRef.current = onSpeechError;

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const busy = isStarting || isListening;

  // Detect and initialize the browser API after hydration.
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMode("none");
      return;
    }

    let speechRecognition: SpeechRecognition;
    try {
      speechRecognition = new SpeechRecognition();
    } catch {
      setMode("none");
      return;
    }

    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    const handleStart = () => {
      setIsStarting(false);
      if (!isHoldingRef.current) {
        speechRecognition.stop();
        return;
      }
      setIsListening(true);
    };

    const handleEnd = () => {
      setIsStarting(false);
      setIsListening(false);
    };

    const handleResult = (event: Event) => {
      const speechEvent = event as SpeechRecognitionEvent;
      let finalTranscript = "";

      for (
        let i = speechEvent.resultIndex;
        i < speechEvent.results.length;
        i += 1
      ) {
        const result = speechEvent.results[i];
        if (result.isFinal) {
          finalTranscript += result[0]?.transcript ?? "";
        }
      }

      if (finalTranscript) {
        onTranscriptionChangeRef.current?.(finalTranscript);
      }
    };

    const handleError = (event: Event) => {
      setIsStarting(false);
      setIsListening(false);
      const error = (event as SpeechRecognitionErrorEvent).error;
      const message = speechRecognitionErrorMessage(error);
      if (message) onErrorRef.current?.(message);
    };

    speechRecognition.addEventListener("start", handleStart);
    speechRecognition.addEventListener("end", handleEnd);
    speechRecognition.addEventListener("result", handleResult);
    speechRecognition.addEventListener("error", handleError);

    recognitionRef.current = speechRecognition;
    setMode("speech-recognition");

    return () => {
      speechRecognition.removeEventListener("start", handleStart);
      speechRecognition.removeEventListener("end", handleEnd);
      speechRecognition.removeEventListener("result", handleResult);
      speechRecognition.removeEventListener("error", handleError);
      try {
        speechRecognition.stop();
      } catch {
        // Some implementations throw when stop() is called before start().
      }
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (busy || !recognition) return;

    try {
      recognition.lang = lang;
      setIsStarting(true);
      recognition.start();
    } catch {
      setIsStarting(false);
      onErrorRef.current?.("Dictation could not be started.");
    }
  }, [busy, lang]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  // Global pointerup to catch release even when pointer leaves the button
  useEffect(() => {
    if (!(isListening || isStarting)) return;

    const handleGlobalPointerUp = () => {
      isHoldingRef.current = false;
      stopListening();
    };

    document.addEventListener("pointerup", handleGlobalPointerUp);
    document.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      document.removeEventListener("pointerup", handleGlobalPointerUp);
      document.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [isListening, isStarting, stopListening]);

  const isDisabled = Boolean(disabledProp) || mode !== "speech-recognition";
  const ariaLabel =
    buttonProps["aria-label"] ??
    t(isListening
      ? "Release to stop dictation"
      : isDisabled
        ? "Dictation unavailable"
        : "Hold to dictate");

  const release = () => {
    isHoldingRef.current = false;
    stopListening();
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Animated pulse rings */}
      {isListening &&
        [0, 1, 2].map((index) => (
          <div
            className="absolute inset-0 animate-ping rounded-full border-2 border-red-400/30"
            key={index}
            style={{
              animationDelay: `${index * 0.3}s`,
              animationDuration: "2s",
            }}
          />
        ))}

      {/* Main record button — hold to talk */}
      <Button
        {...buttonProps}
        className={cn(
          "relative z-10 rounded-full transition-all duration-300 select-none touch-none",
          isListening
            ? "bg-destructive text-white hover:bg-destructive/80 hover:text-white"
            : "bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
          className
        )}
        disabled={isDisabled}
        aria-label={ariaLabel}
        onPointerDown={(e) => {
          onPointerDownProp?.(e);
          if (e.defaultPrevented || e.button !== 0) return;
          e.preventDefault();
          isHoldingRef.current = true;
          startListening();
        }}
        onPointerUp={(e) => {
          onPointerUpProp?.(e);
          release();
        }}
        onPointerCancel={(e) => {
          onPointerCancelProp?.(e);
          release();
        }}
        onKeyDown={(e) => {
          onKeyDownProp?.(e);
          if (
            e.defaultPrevented ||
            e.repeat ||
            (e.key !== " " && e.key !== "Enter")
          ) {
            return;
          }
          e.preventDefault();
          isHoldingRef.current = true;
          startListening();
        }}
        onKeyUp={(e) => {
          onKeyUpProp?.(e);
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          release();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isStarting ? <Spinner /> : isListening
          ? <SquareIcon className="size-4" />
          : <MicIcon className="size-4" />}
      </Button>
    </div>
  );
};
