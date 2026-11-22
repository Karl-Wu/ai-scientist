import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantMessageBody, ChatMessageRow } from "./chat-tab";
import { I18nProvider } from "./i18n-provider";
import { AppearancePanel } from "./settings/appearance-panel";
import { useShowReasoningDetails } from "@/lib/reasoning-display";
import * as localeSettings from "@/lib/ui-locale-settings";
import type { ActivityItem, ChatMessage } from "@/lib/use-agent";

describe("AssistantMessageBody", () => {
  it("skips unchanged history rows without disabling their copy action", () => {
    const content = vi.fn(() => "Completed reply");
    const message: ChatMessage = { id: "old", role: "assistant", timestamp: 1, get content() { return content(); } };
    const onCopy = vi.fn();
    const response = { entryId: "completed-answer", content: "Completed reply", feedback: null, children: [] };
    const props = { message, response, isStreaming: false, isLast: false, sessionId: "s", projectId: "default", copied: false, onCopy };
    const { rerender } = render(<ChatMessageRow {...props} />);
    const reads = content.mock.calls.length;
    rerender(<ChatMessageRow {...props} />);
    expect(content).toHaveBeenCalledTimes(reads);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledWith("old", "Completed reply");
  });

  it("shows answer controls only when a reply has finished and matches a saved answer", () => {
    const message: ChatMessage = { id: "reply", role: "assistant", timestamp: 1, content: "Checked the sample." };
    const response = { entryId: "saved-answer", content: message.content, feedback: null, children: [] };
    const props = {
      message, sessionId: "s", projectId: "default", copied: false,
      onCopy: vi.fn(), onOpenTask: vi.fn(), onCreateNote: vi.fn(),
    };
    const actions = /^(Like|Dislike|Copy|New task from here|Create note from this answer)$/;
    const { rerender } = render(<ChatMessageRow {...props} isLast={false} isStreaming={false} />);
    expect(screen.getByText(message.content)).toBeVisible();
    expect(screen.queryByRole("button", { name: actions })).not.toBeInTheDocument();

    rerender(<ChatMessageRow {...props} isLast isStreaming response={response} />);
    expect(screen.queryByRole("button", { name: actions })).not.toBeInTheDocument();

    rerender(<ChatMessageRow {...props} isLast isStreaming={false} response={response} />);
    expect(screen.getAllByRole("button", { name: actions })).toHaveLength(5);
  });
  it("shows the original headings in stream order after expanding reasoning", () => {
    const reasoning = "**Review the inputs**\n\nIntermediate reasoning with **inline emphasis**.\n\n## Compare files\n\nThe schemas match.\n\n~~~md\n**Example markup**\n~~~";
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      content: "Before tool.\n\nAfter tool.",
      reasoning,
      timestamp: 1,
      activities: [
        {
          id: "tool-1",
          label: "bash",
          status: "complete",
          timestamp: 2,
          toolName: "bash",
          args: { command: "sleep 5" },
        },
      ],
      segments: [
        { type: "text", content: "Before tool.\n\n" },
        { type: "reasoning", content: reasoning },
        { type: "activity", activityId: "tool-1" },
        { type: "text", content: "After tool." },
      ],
    };

    const reply = (showReasoningDetails: boolean) => (
      <AssistantMessageBody
        message={message}
        isStreaming={false}
        isLast
        showReasoningDetails={showReasoningDetails}
        sessionId="session-1"
        projectId="default"
      />
    );

    const { rerender } = render(reply(false));
    const before = screen.getByText("Before tool.");
    const execution = screen.getByRole("button", { name: "Ran 1 tool call" });
    expect(execution).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Review the inputs")).not.toBeInTheDocument();
    fireEvent.click(execution);
    const first = screen.getByText("Review the inputs");
    const second = screen.getByText("Compare files");
    expect(before.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/inline emphasis|Example markup/)).not.toBeInTheDocument();

    rerender(reply(true));
    const disclosure = screen.getByRole("button", { name: "Review the inputs, Compare files" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Intermediate reasoning/)).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    const summary = screen.getByText(/Intermediate reasoning/);
    const tool = screen.getByRole("button", { name: /bash.*sleep 5/ });
    const after = screen.getByText("After tool.");

    expect(summary.textContent).toBe(reasoning);
    expect(tool).not.toBeNull();
    expect(
      before.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(tool!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tool!.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows only the latest live title and collapses titles and tools into one historical summary", () => {
    const message: ChatMessage = {
      id: "assistant", role: "assistant", content: "", timestamp: 1,
      activities: [
        { id: "read", label: "read", toolName: "read", status: "error", timestamp: 2, args: { path: "dataset.tsv" } },
        { id: "bash", label: "bash", toolName: "bash", status: "unknown", timestamp: 3, args: { command: "python --version" } },
      ],
      segments: [
        { type: "reasoning", content: "**Evaluating dataset accuracy**\n\n**Addressing coding issues**" },
        { type: "reasoning", content: "**Fixing covariance issues**" },
        { type: "activity", activityId: "read" },
        { type: "reasoning", content: "**Checking Python version**\n\n**Choosing a runtime**" },
        { type: "activity", activityId: "bash" },
        { type: "reasoning", content: "An untitled continuation." },
      ],
    };
    const props = { message, isLast: true, sessionId: "s", projectId: "default" };
    const { rerender } = render(<AssistantMessageBody {...props} isStreaming />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Choosing a runtime$/);
    expect(screen.queryByText(/Evaluating dataset accuracy|Checking Python version/)).not.toBeInTheDocument();

    rerender(<AssistantMessageBody {...props} isStreaming={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluating dataset accuracy|Choosing a runtime|unknown status/)).not.toBeInTheDocument();
    const execution = screen.getByRole("button", { name: /Ran 2 tool calls\s*·\s*1 failed/ });
    expect(execution).toHaveTextContent("Ran 2 tool calls · 1 failed");
    fireEvent.click(execution);
    const titles = screen.getByText("Evaluating dataset accuracy").closest("p")!;
    const tool = screen.getByRole("button", { name: /read.*dataset.tsv/ });
    expect(titles).toHaveTextContent(/^Evaluating dataset accuracy · Addressing coding issues$/);
    expect(screen.getByText("Fixing covariance issues").compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.compareDocumentPosition(screen.getByText("Checking Python version")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses a count for past tool groups and previews only the latest live call", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      content: "Checking the result.",
      timestamp: 1,
      segments: [
        { type: "activity", activityId: "past" },
        { type: "text", content: "Checking the result." },
        { type: "activity", activityId: "read" },
        { type: "activity", activityId: "latest" },
      ],
      activities: [
        { id: "past", label: "bash", toolName: "bash", status: "complete", timestamp: 1, args: { command: "ls" } },
        { id: "read", label: "read", toolName: "read", status: "complete", timestamp: 2, args: { path: "report.md" } },
        { id: "latest", label: "bash", toolName: "bash", status: "running", timestamp: 3, args: { command: "pwd" } },
      ],
    };
    const { rerender } = render(
      <AssistantMessageBody message={message} isStreaming isLast sessionId="s" projectId="default" />,
    );
    expect(screen.getByRole("button", { name: "Ran 1 tool call" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /bash.*pwd/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("report.md")).not.toBeInTheDocument();
    rerender(<AssistantMessageBody message={message} isStreaming={false} isLast sessionId="s" projectId="default" />);
    expect(screen.getByRole("button", { name: /Ran 2 tool calls/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("pwd")).not.toBeInTheDocument();
  });

  it("omits retired notebook activity without splitting or inflating the remaining tool group", () => {
    const activities: NonNullable<ChatMessage["activities"]> = [
      { id: "read", status: "complete", label: "read", toolName: "read", timestamp: 1, args: { path: "report.md" } },
      { id: "journal", status: "complete", label: "notebook", toolName: "notebook", timestamp: 2, args: { title: "Old hypothesis" } },
      { id: "recall", status: "error", label: "notebook_search", toolName: "notebook_search", timestamp: 3 },
      { id: "bash", status: "complete", label: "bash", toolName: "bash", timestamp: 4, args: { command: "pwd" } },
    ];
    const message: ChatMessage = {
      id: "old", role: "assistant", content: "Done.", timestamp: 1, activities,
      segments: [
        ...activities.map(({ id }) => ({ type: "activity" as const, activityId: id })),
        { type: "text", content: "Done." },
      ],
    };

    render(<AssistantMessageBody message={message} isStreaming={false} isLast sessionId="s" projectId="default" />);
    const tools = screen.getByRole("button", { name: "Ran 2 tool calls" });
    fireEvent.click(tools);
    expect(screen.getByText("Done.")).toBeVisible();
    expect(screen.getByText("report.md")).toBeVisible();
    expect(screen.queryByText("Old hypothesis")).not.toBeInTheDocument();
    expect(screen.queryByText(/notebook_search/)).not.toBeInTheDocument();
  });

  it("omits a historical row containing only a retired notebook call", () => {
    const message: ChatMessage = {
      id: "old", role: "assistant", content: "", timestamp: 1,
      activities: [{ id: "journal", status: "complete", label: "notebook", toolName: "notebook", timestamp: 1 }],
    };
    const { container } = render(<ChatMessageRow message={message} isStreaming={false} isLast
      sessionId="s" projectId="default" copied={false} onCopy={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("replaces the thinking status with the streamed title and keeps the body hidden by default", () => {
    const reasoning = "**检查输入**\n\n先核对两份文件。";
    const renderReply = (isStreaming: boolean, content: string, showReasoningDetails = false) => (
      <AssistantMessageBody
        message={{ id: "assistant", role: "assistant", content: "", timestamp: 1,
          ...(content ? { reasoning: content, segments: [{ type: "reasoning", content }] } : {}) }}
        isStreaming={isStreaming}
        isLast
        showReasoningDetails={showReasoningDetails}
        sessionId="session-1"
        projectId="default"
      />
    );

    const { rerender } = render(renderReply(true, ""));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking...");
    rerender(renderReply(true, "**检查输"));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking...");
    rerender(renderReply(true, reasoning));
    expect(screen.getByRole("status")).toHaveTextContent(/^检查输入$/);
    expect(screen.queryByRole("button", { name: "检查输入" })).not.toBeInTheDocument();
    rerender(renderReply(false, reasoning));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("检查输入")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Execution details" }));
    expect(screen.getByText("检查输入")).toBeVisible();
    expect(screen.queryByText(/先核对两份文件/)).not.toBeInTheDocument();
    rerender(renderReply(false, "先核对两份文件。"));
    expect(screen.queryByText(/先核对两份文件/)).not.toBeInTheDocument();
  });

  it("applies the appearance setting to the open history and remembers it after reopening", async () => {
    const readLocale = vi.spyOn(localeSettings, "readSavedLocale").mockResolvedValue("en");
    const message: ChatMessage = { id: "old", role: "assistant", content: "", reasoning: "Recorded summary.", timestamp: 1 };
    function HistoryReply() {
      const showReasoningDetails = useShowReasoningDetails();
      return <AssistantMessageBody message={message} isStreaming={false} isLast sessionId="s" projectId="default" showReasoningDetails={showReasoningDetails} />;
    }
    const ui = <I18nProvider><AppearancePanel /><HistoryReply /></I18nProvider>;
    try {
      const { unmount } = render(ui);
      const preference = await screen.findByRole("switch", { name: "Show reasoning details" });
      expect(preference).not.toBeChecked();
      expect(screen.queryByRole("button", { name: "Reasoning" })).not.toBeInTheDocument();
      fireEvent.click(preference);
      expect(preference).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Execution details" }));
      expect(screen.getByRole("button", { name: "Reasoning" })).toHaveAttribute("aria-expanded", "false");
      unmount();
      render(ui);
      const reopenedPreference = await screen.findByRole("switch", { name: "Show reasoning details" });
      expect(reopenedPreference).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Execution details" }));
      fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
      expect(screen.getByText("Recorded summary.")).toBeVisible();
      fireEvent.click(reopenedPreference);
      expect(screen.queryByText("Recorded summary.")).not.toBeInTheDocument();
    } finally {
      readLocale.mockRestore();
    }
  });

  it("renders a preamble before a pending interview", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      content: "I need one detail.\n\n",
      timestamp: 1,
      activities: [
        {
          id: "interview-1",
          label: "Running interview",
          status: "running",
          timestamp: 2,
          toolName: "interview",
          args: {
            title: "Choose an option",
            questions: [
              {
                id: "choice",
                type: "single",
                question: "Which option?",
                options: ["A", "B"],
              },
            ],
          },
        },
      ],
      segments: [
        { type: "text", content: "I need one detail.\n\n" },
        { type: "activity", activityId: "interview-1" },
      ],
    };

    render(
      <AssistantMessageBody
        message={message}
        isStreaming
        isLast
        sessionId="session-1"
        projectId="default"
      />,
    );

    const preamble = screen.getByText("I need one detail.");
    const interview = screen.getByText("Choose an option");
    expect(
      preamble.compareDocumentPosition(interview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders a typed scientific card between surrounding prose", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      content: "Computed the comparison.\n\nInterpretation follows.",
      timestamp: 1,
      activities: [
        {
          id: "result-1",
          label: "Scientific result",
          status: "complete",
          timestamp: 2,
          toolName: "scientific_result",
          startedAt: 1000,
          durationMs: 116,
          scientificResult: {
            schemaVersion: 1,
            kind: "statistical-test",
            title: "Treatment effect",
            tests: [{ name: "Welch t-test", pValue: 0.02 }],
          },
        },
      ],
      segments: [
        { type: "text", content: "Computed the comparison.\n\n" },
        { type: "activity", activityId: "result-1" },
        { type: "text", content: "Interpretation follows." },
      ],
    };

    const { container } = render(
      <AssistantMessageBody
        message={message}
        isStreaming={false}
        isLast
        sessionId="session-1"
        projectId="default"
      />,
    );

    const before = screen.getByText("Computed the comparison.");
    const card = container.querySelector('[data-tool-call-id="result-1"]');
    const after = screen.getByText("Interpretation follows.");
    expect(card).not.toBeNull();
    expect(screen.queryByText(/^Started /)).not.toBeInTheDocument();
    expect(screen.queryByText("116 ms")).not.toBeInTheDocument();
    expect(
      before.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      card!.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("folds the process under elapsed time as soon as a streaming summary is confirmed", () => {
    const message: ChatMessage = {
      id: "answer",
      role: "assistant",
      content: "I’ll check the inputs and compare them.\nBoth inputs passed.",
      timestamp: 1,
      summary: { blockId: "summary", confirmed: false, executionMs: 216_000 },
      activities: [
        { id: "read", label: "read", toolName: "read", status: "error", timestamp: 2, args: { path: "dataset.tsv" } },
        ...["A", "B"].map<ActivityItem>((id) => ({
          id, label: "scientific_result", status: "complete", timestamp: 2, toolName: "scientific_result",
          scientificResult: {
            schemaVersion: 1, kind: "table", title: `Result ${id}`,
            columns: [{ key: "metric", label: "Metric" }], rows: [[id]],
          },
        })),
      ],
      segments: [
        { type: "text", blockId: "progress", content: "I’ll check the inputs and compare them." },
        { type: "activity", activityId: "read" },
        { type: "reasoning", content: "**核对检查结果**" },
        { type: "activity", activityId: "A" },
        { type: "activity", activityId: "B" },
        { type: "text", blockId: "summary", content: "Both inputs passed.\n\n**Checks**\n\n- Matches the **reference**." },
      ],
    };
    const reply = (confirmed: boolean) => (
      <AssistantMessageBody
        message={{ ...message, summary: { ...message.summary!, confirmed } }}
        isStreaming
        isLast
        sessionId="s"
        projectId="default"
      />
    );
    const { rerender } = render(reply(false));
    expect(screen.getByText("I’ll check the inputs and compare them.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("核对检查结果");
    expect(screen.queryByRole("button", { name: /^Execution took/ })).not.toBeInTheDocument();
    expect(screen.getByText("Both inputs passed.").closest("[data-task-summary]")).toBeNull();
    const before = screen.getByRole("heading", { name: "Result A" });
    expect(before.compareDocumentPosition(screen.getByText("Both inputs passed.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(reply(true));
    const disclosure = screen.getByRole("button", { name: "Execution took 3 minutes 36 seconds" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("I’ll check the inputs and compare them.")).not.toBeInTheDocument();
    expect(screen.queryByText("核对检查结果")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const summary = screen.getByText("Both inputs passed.");
    expect(summary.closest("[data-task-summary]")).not.toBeNull();
    expect(screen.getByText("Checks").closest("p")).toHaveAttribute("data-standalone-strong");
    expect(screen.getByText("reference").closest("li")).toBeInTheDocument();
    const first = screen.getByRole("heading", { name: "Result A" });
    const second = screen.getByRole("heading", { name: "Result B" });
    expect(summary.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(disclosure);
    const opening = screen.getByText("I’ll check the inputs and compare them.");
    const tool = screen.getByRole("button", { name: /read.*dataset.tsv/ });
    const reasoning = screen.getByText("核对检查结果");
    expect(opening).toBeVisible();
    expect(opening.closest("[data-task-summary]")).toBeNull();
    expect(opening.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Ran 1 tool call/)).toHaveTextContent("Ran 1 tool call · 1 failed");
    expect(screen.getAllByRole("heading", { name: /^Result (A|B)$/ })).toHaveLength(2);
  });
});
