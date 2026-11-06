import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "./i18n-provider";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { FileTreePanel } from "./sandbox-panel";
import { TooltipProvider } from "./ui/tooltip";
import type { TreeNode } from "@/lib/use-sandbox";

function renderLargeTree(fileCount = 38_000, onUpload = vi.fn()) {
  const tree: TreeNode = {
    name: "sandbox",
    path: "",
    type: "directory",
    children: [
      {
        name: "dataset",
        path: "dataset",
        type: "directory",
        children: Array.from({ length: fileCount }, (_, index) => ({
          name: `image-${index}.dcm`,
          path: `dataset/image-${index}.dcm`,
          type: "file",
        })),
      },
    ],
  };
  const noop = vi.fn();

  render(
    <I18nProvider><TooltipProvider>
      <div style={{ height: 700 }}>
        <FileTreePanel
          tree={tree}
          selectedPath={null}
          uploading={false}
          onSelect={noop}
          onDownload={noop}
          onDelete={noop}
          onDownloadDir={noop}
          onDeleteDir={noop}
          onDownloadAll={noop}
          onRefresh={noop}
          onClose={noop}
          onUpload={onUpload}
          onMove={noop}
          onRename={noop}
          onCreateDir={noop}
        />
      </div>
    </TooltipProvider></I18nProvider>,
  );
}

afterEach(() => window.localStorage.removeItem(LOCALE_STORAGE_KEY));

describe("FileTreePanel", () => {
  it("localizes the collapse tooltip with the same title and description format as the toolbar", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    renderLargeTree(0);
    act(() => screen.getByRole("button", { name: "收起文件列表" }).focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("收起文件列表");
    expect(tooltip).toHaveTextContent("为内容预览腾出更多空间，可通过右侧边缘把手重新展开文件列表。");
    expect(tooltip).not.toHaveTextContent("Hide file list");
  });

  it("keeps the browser Files drag protocol working in Chinese", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    const onUpload = vi.fn();
    renderLargeTree(0, onUpload);
    const panel = screen.getByRole("tree").parentElement!;
    const file = new File(["cell_id,age"], "Method.csv", { type: "text/csv" });
    const dataTransfer = { types: ["Files"], files: [file], items: [], dropEffect: "none" };
    fireEvent.dragEnter(panel, { dataTransfer });
    expect(screen.getByText("拖放文件或文件夹以上传")).toBeInTheDocument();
    fireEvent.drop(panel, { dataTransfer });
    expect(onUpload).toHaveBeenCalledWith([file]);
  });

  it("keeps a 38k-file directory collapsed and virtualizes it when opened", () => {
    renderLargeTree();

    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(screen.queryByText("image-0.dcm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("dataset"));

    expect(screen.getByText("image-0.dcm")).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(36);
    expect(screen.queryByText("image-1000.dcm")).not.toBeInTheDocument();
  });
});
