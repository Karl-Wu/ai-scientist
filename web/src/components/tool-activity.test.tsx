import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ModalJobChip, ToolActivityList, ToolTiming } from "./tool-activity";
import type { ActivityItem } from "@/lib/use-agent";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: "tc_9",
  label: "Running notebook",
  status: "complete",
  timestamp: 1000,
  ...over,
});

describe("ToolActivityList", () => {
  it("shows multiline file content as a field and lets the user view the raw JSON", () => {
    const path = "scripts/export.py";
    const content = 'def export():\n    return "ready"\n';
    const args = { path, content, overwrite: false, mode: null };
    const { container } = render(<ToolActivityList activities={[
      item({ toolName: "write", args, result: "Saved export.py" }),
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ran 1 tool call" }));
    fireEvent.click(screen.getByRole("button", { name: /^write/i }));

    const fields = container.querySelector("dl")!;
    expect(within(fields).getByText(path)).toBeVisible();
    expect(within(fields).getByText("false")).toBeVisible();
    expect(within(fields).getByText("null")).toBeVisible();
    expect(fields.querySelectorAll("code")[1].textContent).toBe(content);

    fireEvent.click(screen.getByRole("button", { name: "View raw JSON" }));
    expect(container.querySelector("dl")).not.toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify(args, null, 2));
    fireEvent.click(screen.getByRole("button", { name: "View fields" }));
    expect(container.querySelectorAll("dl code")[1].textContent).toBe(content);
  });

  it("separates the shell command from its parameters and formats JSON in output without changing values", () => {
    const command = "python example.py <<'PY'\nprint(42)\nPY";
    const output = 'exit=0\nsummary {"id":9007199254740993,"values":[1,"line\\n2"]}\ncut {"unfinished":…';
    const { container } = render(<ToolActivityList activities={[
      item({ toolName: "bash", args: { command, timeout: 120 }, result: output }),
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ran 1 tool call" }));
    fireEvent.click(screen.getByRole("button", { name: /^bash/i }));
    expect(screen.getByText("Command")).toBeVisible();
    expect(screen.getByText("Parameters")).toBeVisible();
    const [commandBlock, parametersBlock, outputBlock] = container.querySelectorAll("pre");
    expect(commandBlock.textContent).toBe(command);
    expect(parametersBlock.textContent).toBe('{\n  "timeout": 120\n}');
    expect(outputBlock.textContent).toBe(
      'exit=0\nsummary {\n  "id": 9007199254740993,\n  "values": [\n    1,\n    "line\\n2"\n  ]\n}\ncut {"unfinished":…',
    );
    fireEvent.click(screen.getByRole("button", { name: "View raw output" }));
    expect(outputBlock.textContent).toBe(output);
    fireEvent.click(screen.getByRole("button", { name: "View formatted output" }));
    expect(outputBlock.textContent).toContain('\n  "id": 9007199254740993,');
  });

  it("shows elapsed time and status on each row, with start time and results inside", () => {
    render(<ToolActivityList activities={[
      item({ id: "finished", toolName: "read", startedAt: 1000, durationMs: 1240, result: "file content" }),
      item({ id: "failed", toolName: "write", status: "error", durationMs: 116, result: "Write failed" }),
      item({ id: "interrupted", toolName: "bash", status: "unknown" }),
    ]} />);
    const group = screen.getByRole("button", { name: /Ran 3 tool calls/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Status unknown" })).not.toBeInTheDocument();
    fireEvent.click(group);
    const read = screen.getByRole("button", { name: /^read/i });
    expect(within(read).getByTitle("Duration")).toHaveTextContent("1.2");
    expect(within(read).getByRole("img", { name: "Completed" })).toBeInTheDocument();
    const failed = screen.getByRole("button", { name: /^write/i });
    expect(within(failed).getByTitle("Duration")).toHaveTextContent("116 ms");
    expect(within(failed).getByRole("img", { name: "Failed" })).toBeInTheDocument();
    const interrupted = screen.getByRole("button", { name: /^bash/i });
    expect(within(interrupted).getByRole("img", { name: "Status unknown" })).toBeInTheDocument();
    expect(within(interrupted).queryByTitle("Duration")).not.toBeInTheDocument();
    expect(screen.queryByText("Start time unknown")).not.toBeInTheDocument();
    expect(screen.queryByText("Duration unknown")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Started /)).not.toBeInTheDocument();
    fireEvent.click(read);
    expect(screen.getByText(/^Started /)).toBeInTheDocument();
    expect(screen.getByText("file content")).toBeInTheDocument();
  });

  it("renders each timing value independently and omits the row when both are missing", () => {
    const { container, rerender } = render(<ToolTiming item={item()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ToolTiming item={item({ startedAt: 1000 })} />);
    expect(screen.getByText(/^Started /)).toBeInTheDocument();
    expect(screen.queryByText("Duration unknown")).not.toBeInTheDocument();

    rerender(<ToolTiming item={item({ durationMs: 0 })} />);
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    expect(screen.queryByText(/^Started /)).not.toBeInTheDocument();
    expect(screen.queryByText("Start time unknown")).not.toBeInTheDocument();
  });

  it("previews only the latest live call and expands earlier calls in the same group", () => {
    const { container } = render(
      <ToolActivityList
        current
        activities={[
          item({ id: "tc_a", toolName: "bash", args: { command: "ls" } }),
          item({ id: "tc_b", toolName: "read", args: { path: "notes.md" }, status: "running" }),
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("notes.md");
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status", { name: "Tool calls running" })).toBeInTheDocument();
    expect(container.querySelector("[data-tool-call-id]")).toBeNull();
    fireEvent.click(buttons[0]);
    expect([...container.querySelectorAll("[data-tool-call-id]")].map((card) => card.getAttribute("data-tool-call-id")))
      .toEqual(["tc_a", "tc_b"]);
  });

  it("renders nothing for an empty activity list", () => {
    const { container } = render(<ToolActivityList activities={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the specialist name from a single-task subagent call", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "subagent",
            args: {
              tasks: [
                {
                  agent: "statistical-reviewer",
                  task: "Audit the final analysis",
                },
              ],
            },
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("statistical-reviewer: Audit the final analysis"),
    ).toBeInTheDocument();
    expect(screen.queryByText("subtask")).not.toBeInTheDocument();
  });

  it("reads specialist names out of a workflowScript launch", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "subagent",
            args: {
              workflowScript:
                'const a = runs.run("lit", { agent: "literature-reviewer", task: "Survey" });\n' +
                "const b = runs.run('stats', { agent: 'statistical-reviewer', task: 'Audit' });",
            },
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("literature-reviewer + statistical-reviewer"),
    ).toBeInTheDocument();
  });

  it("names the specialists of a workflow: true launch from its reply block", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "subagent",
            args: { workflow: true },
            replyWorkflowScript:
              'const a = await runs.run("lit", { agent: "literature-reviewer", task: "Survey" });\n' +
              "return runs.run('stats', { agent: 'statistical-reviewer', task: a.text });",
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("literature-reviewer + statistical-reviewer"),
    ).toBeInTheDocument();
  });

  it.each([
    [{ workflow: true }, "workflow script"],
    [{ workflow: "./ci/sweep.js" }, "workflow ./ci/sweep.js"],
    [{ workflow: "lab-sweep" }, "workflow “lab-sweep”"],
  ])("summarizes an unnamed %j launch by its workflow source", (args, text) => {
    render(<ToolActivityList current activities={[item({ toolName: "subagent", args })]} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("subtask")).not.toBeInTheDocument();
  });

  it.each([
    [{ workflow: "review", args: { task: "check" } }, ["reviewer"]],
    [{ workflow: "parallel", args: { tasks: [{ agent: "scout", task: "a" }, { agent: "worker", task: "b" }] } }, ["scout", "worker"]],
  ])("names the children of pi-subagents' own %j workflow", (args, names) => {
    render(<ToolActivityList current activities={[item({ toolName: "subagent", args })]} />);
    for (const name of names) expect(screen.getByText(name, { exact: false })).toBeInTheDocument();
  });

  it("summarizes generate_image by its prompt and shows the image without expanding", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "generate_image",
            args: {
              prompt: "Schematic of the single-cell RNA-seq pipeline\nflat vector style",
              path: "figures/pipeline.png",
            },
            result: "Saved figures/pipeline.png",
            resultImages: [{ data: "aGVsbG8=", mimeType: "image/png" }],
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("Schematic of the single-cell RNA-seq pipeline"),
    ).toBeInTheDocument();
    expect(screen.queryByText("figures/pipeline.png")).not.toBeInTheDocument();
    expect(screen.getByAltText("Tool result image 1")).toBeInTheDocument();
  });

  it("labels the pi-subagents wait tool", () => {
    render(
      <ToolActivityList current
        activities={[item({ toolName: "bg_wait", args: { id: "run-1" } })]}
      />,
    );
    expect(screen.getByText("wait for subagents")).toBeInTheDocument();
  });

  it("shows every specialist name from a parallel subagent call", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "subagent",
            args: {
              tasks: [
                { agent: "researcher", task: "Find sources" },
                { agent: "methodology-reviewer", task: "Review methods" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("researcher + methodology-reviewer"),
    ).toBeInTheDocument();
  });

  it("recovers the specialist name from a completed status result", () => {
    render(
      <ToolActivityList current
        activities={[
          item({
            toolName: "subagent",
            args: { action: "status", id: "run-1" },
            result: "Step 1: statistical-reviewer running, active but long-running",
          }),
        ]}
      />,
    );
    expect(screen.getByText("statistical-reviewer")).toBeInTheDocument();
  });

  it("shows bounded Pi image blocks in the generic fallback card", () => {
    render(
      <ToolActivityList
        activities={[
          item({
            toolName: "mcp__microscope__capture",
            resultImages: [{ data: "aGVsbG8=", mimeType: "image/png" }],
            resultImagesTruncated: 1,
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ran 1 tool call" }));
    fireEvent.click(screen.getByRole("button", { name: /mcp__microscope__capture/i }));
    expect(screen.getByAltText("Tool result image 1")).toBeInTheDocument();
    expect(screen.getByText(/1 image omitted/)).toBeInTheDocument();
  });
});

describe("ModalJobChip", () => {
  it("links a durable tool result to its Compute job detail", () => {
    const onView = vi.fn();
    render(
      <ModalJobChip
        item={item({
          toolName: "modal_submit",
          result: JSON.stringify({ jobId: "job-abc123", status: "queued" }),
        })}
        onView={onView}
      />,
    );
    expect(screen.getByText("job-abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View job" }));
    expect(onView).toHaveBeenCalledWith("job-abc123");
  });

  it("still opens the Compute panel when a Modal result has no job id", () => {
    const onView = vi.fn();
    render(
      <ModalJobChip
        item={item({ toolName: "modal_run", result: "Compute completed" })}
        onView={onView}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Compute" }));
    expect(onView).toHaveBeenCalledWith(undefined);
  });
});
