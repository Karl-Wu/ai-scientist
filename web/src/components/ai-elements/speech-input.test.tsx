import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechInput } from "@/components/ai-elements/speech-input";

const recognize = vi.fn();
class FakeSpeechRecognition extends EventTarget {
  lang = "";

  start() {
    recognize(this.lang);
    this.dispatchEvent(new Event("start"));
  }

  stop() {
    this.dispatchEvent(new Event("end"));
  }
}

describe("SpeechInput", () => {
  beforeEach(() => {
    recognize.mockClear();
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the selected Chinese language for browser recognition", async () => {
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    const { rerender } = render(<SpeechInput lang="en-US" />);
    rerender(<SpeechInput lang="zh-CN" />);

    const button = await screen.findByRole("button", { name: "Hold to dictate" });
    fireEvent.pointerDown(button, { button: 0 });
    expect(recognize).toHaveBeenCalledWith("zh-CN");
    expect(button).toHaveAccessibleName("Release to stop dictation");

    fireEvent.pointerUp(button, { button: 0 });
    expect(button).toHaveAccessibleName("Hold to dictate");
  });

  it("disables dictation when browser recognition is unavailable", async () => {
    render(<SpeechInput />);

    expect(await screen.findByRole("button", {
      name: "Dictation unavailable",
    })).toBeDisabled();
  });
});
