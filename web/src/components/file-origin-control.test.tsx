import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessageBody } from "./chat-tab";
import { FilePreviewPanel } from "./file-preview-panel";
import { apiFetch } from "@/lib/projects";
import type { ArtifactProvenance, FileOrigin, FileSourceFocus, FileSourceStep, ProvenanceStep, SourceStepReference } from "@/lib/provenance";
import type { ChatMessage } from "@/lib/use-agent";

vi.mock("@/lib/projects", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/projects")>(),
  apiFetch: vi.fn(),
}));

const resultStep: FileSourceStep = {
  sessionId: "task-a", stepId: "make-result", runId: "run-a", timestamp: 2000,
  role: "agent", toolName: "bash", change: "created", evidence: "scan-inferred",
  inputs: [{ path: "cleaned.csv", confidence: "inferred" }],
  outputs: [{ path: "result.csv", evidence: "scan-inferred" }],
};
const originalStep: FileSourceStep = {
  sessionId: "task-a", stepId: "clean-v1", runId: "run-a", timestamp: 1000,
  role: "agent", toolName: "write", change: "created", evidence: "recorded",
  inputs: [], outputs: [{ path: "cleaned.csv", evidence: "recorded" }],
};
const resultProducer: ProvenanceStep = {
  schemaVersion: 1, id: resultStep.stepId, sessionId: resultStep.sessionId, runId: resultStep.runId,
  timestamp: resultStep.timestamp, toolName: resultStep.toolName, role: resultStep.role,
  inputs: [{ path: "cleaned.csv", size: 10, mtimeMs: 1000, change: "read", confidence: "inferred" }],
  outputs: [{ path: "result.csv", size: 10, mtimeMs: 1000, change: "created", confidence: "inferred" }],
};

const message: ChatMessage = {
  id: "answer", role: "assistant", timestamp: 500, content: "Finished.",
  summary: { blockId: "summary", confirmed: true },
  activities: [originalStep, resultStep].map((step) => ({
    id: step.stepId, label: step.toolName, toolName: step.toolName, timestamp: step.timestamp,
    status: "complete", result: step.stepId === "clean-v1" ? "Original cleanup output" : "Final analysis output",
  })),
  segments: [
    { type: "activity", activityId: "clean-v1" },
    { type: "activity", activityId: "make-result" },
    { type: "text", blockId: "summary", content: "Finished." },
  ],
};

function WorkspaceFixture() {
  const [file, setFile] = useState<{ path: string; consumer?: SourceStepReference }>({ path: "result.csv" });
  const [focus, setFocus] = useState<FileSourceFocus>();
  return (
    <>
      <FilePreviewPanel
        projectId="test-project"
        tabs={[{ path: file.path, content: "id,value\n1,2", loading: false }]}
        activeTabPath={file.path}
        fileSourceInput={file.consumer ? { path: file.path, consumer: file.consumer, nonce: 1 } : undefined}
        onJumpToFileSource={(step) => setFocus({ step, nonce: (focus?.nonce ?? 0) + 1 })}
        onOpenSourceInput={(path, consumer) => setFile({ path, consumer })}
        onTabSelect={vi.fn()}
        onTabClose={vi.fn()}
        onDownload={vi.fn()}
        onSaveText={async () => true}
        onSaveImageBlob={async () => true}
        showNotebook={false}
        onSelectNotebook={vi.fn()}
        showCompute={false}
        onSelectCompute={vi.fn()}
        computeSessionId={null}
        computeScope="project"
        onComputeScopeChange={vi.fn()}
        onOpenComputeOutput={vi.fn()}
        notebookSessionId={null}
        notebookEntries={[]}
        notebookStreaming={false}
        notebookSubagentCompletions={0}
        onOpenNotebookFile={vi.fn()}
      />
      <section aria-label="Task transcript">
        <AssistantMessageBody
          message={message}
          isLast
          isStreaming={false}
          sessionId="task-a"
          projectId="test-project"
          fileSourceFocus={focus}
        />
      </section>
    </>
  );
}

describe("file source shortcut", () => {
  it("labels inferred scans, expands the recorded step, and follows a historical input version", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      const request = new URL(url, "http://localhost");
      const query = request.searchParams;
      if (request.pathname === "/sandbox/provenance") {
        const current = { size: 10, mtimeMs: 1000 };
        const details: ArtifactProvenance = {
          path: query.get("path") ?? "", exists: true, current,
          producedBy: [], readBy: [], readByTotal: 0, citedBy: [], staleness: "unknown",
          lineage: { nodes: [], edges: [], steps: {}, truncated: false }, environments: {},
        };
        if (details.path === "result.csv") {
          details.producedBy = [resultProducer];
          details.lineage = {
            nodes: [
              { path: "result.csv", depth: 0, current, stepId: resultProducer.id },
              { path: "cleaned.csv", depth: 1, current, changedSinceUse: true },
            ],
            edges: [{ from: "cleaned.csv", to: "result.csv", stepId: resultProducer.id, confidence: "inferred" }],
            steps: { [resultProducer.id]: resultProducer },
            truncated: false,
          };
        }
        return Response.json(details);
      }
      const source = query.get("path") === "result.csv" ? resultStep : originalStep;
      const data: FileOrigin = source === resultStep
        ? { status: "matched", changedSinceUse: null, source, history: [source] }
        : { status: "historical", changedSinceUse: true, inputConfidence: "inferred", source, history: [source] };
      return Response.json(data);
    });
    render(<WorkspaceFixture />);
    expect(screen.getByRole("button", { name: "Execution details" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Provenance" }));
    expect(await screen.findByText("Inferred from sandbox scan")).toBeVisible();
    const jump = screen.getByRole("button", { name: "View generating step" });
    const details = await screen.findByText("This version");
    expect(jump.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(jump);
    expect(screen.getByText("Final analysis output")).toBeVisible();
    expect(screen.queryByText("Original cleanup output")).not.toBeInTheDocument();
    const chat = within(screen.getByRole("region", { name: "Task transcript" }));
    expect(chat.queryByText("Inferred from sandbox scan")).not.toBeInTheDocument();
    expect(chat.queryByText("Recorded inputs")).not.toBeInTheDocument();
    expect(chat.queryByRole("button", { name: "cleaned.csv" })).not.toBeInTheDocument();

    await user.click(within(screen.getByTestId("provenance-lineage")).getByRole("button", { name: "cleaned.csv" }));
    expect(await screen.findByText("The working file has changed since this step used it.")).toBeVisible();
    expect(screen.getByText("Inferred input")).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith(
      "/sandbox/file-origin?path=cleaned.csv&sessionId=task-a&stepId=make-result&runId=run-a",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      "test-project",
    );
    await user.click(screen.getByRole("button", { name: "View generating step" }));
    expect(screen.getByText("Original cleanup output")).toBeVisible();
    expect(screen.queryByText("Final analysis output")).not.toBeInTheDocument();
    expect(screen.queryByText("Recorded inputs")).not.toBeInTheDocument();
    expect(screen.queryByText("No inputs recorded for this step")).not.toBeInTheDocument();
  });
});
