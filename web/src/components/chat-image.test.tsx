import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChatImage } from "./chat-image";

it("enlarges on click, supports original size, and closes with Escape", () => {
  render(<ChatImage src="data:image/png;base64,aGVsbG8=" alt="Attached screenshot" />);
  const thumbnail = screen.getByRole("button", { name: "Attached screenshot" });
  fireEvent.click(thumbnail);
  const dialog = screen.getByRole("dialog", { name: "Image preview" });
  expect(within(dialog).getByRole("img")).toHaveAttribute("src", "data:image/png;base64,aGVsbG8=");
  fireEvent.click(within(dialog).getByRole("button", { name: "Actual size" }));
  expect(within(dialog).getByRole("button", { name: "Fit to window" })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(thumbnail);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Actual size" })).toBeInTheDocument();
});
