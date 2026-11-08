import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useInputHistory } from "./use-input-history";
function Composer({ history = ["First question", "Second question"], draft = "" }: { history?: string[]; draft?: string }) {
  const [text, setText] = useState(draft);
  const recall = useInputHistory(history, setText);
  return <textarea aria-label="Message" value={text} onChange={e => { recall.reset(); setText(e.target.value); }} onKeyDown={recall.onKeyDown} />;
}
describe("composer input history", () => {
  it("walks backward and forward and restores the unsent draft", () => {
    render(<Composer draft="Unsent draft" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("Second question");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("First question");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("First question");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("Second question");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("Unsent draft");
  });
  it("leaves multiline cursor movement, text selections and IME composition alone", () => {
    render(<Composer draft={'One\nTwo'} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe('One\nTwo');
    input.setSelectionRange(0, 2);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe('One\nTwo');
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowUp", isComposing: true });
    expect(input.value).toBe('One\nTwo');
  });
  it("starts a new draft after editing recalled text and scopes history to its composer", () => {
    render(<Composer history={["This session only"]} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.change(input, { target: { value: "Edited question" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("Edited question");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("This session only");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("Edited question");
  });
});
