import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { htmlPreviewDocument } from "@/lib/html-preview";
import { apiFetch } from "@/lib/projects";
import { StandaloneHtmlPreview } from "./standalone-html-preview";

vi.mock("@/lib/projects", () => ({ apiFetch: vi.fn() }));

it("shows only the sandboxed report without a header, toolbar or app zoom", async () => {
  const html = '<details><summary>Report</summary><p>Content</p></details><script>document.title = "Report";</script>';
  vi.mocked(apiFetch).mockResolvedValueOnce(new Response(html));
  render(<StandaloneHtmlPreview path="reports/lineage.html" projectId="lineage" />);

  const frame = await screen.findByTitle("HTML preview");
  expect(apiFetch).toHaveBeenCalledWith("/sandbox/file?path=reports%2Flineage.html", expect.anything(), "lineage");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(frame).toHaveAttribute("srcdoc", htmlPreviewDocument(html, "HTML preview"));
  expect(frame).not.toHaveAttribute("style");
  expect(screen.getByRole("main").children).toHaveLength(1);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
