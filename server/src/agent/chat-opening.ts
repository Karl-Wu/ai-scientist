import type { ExtensionFactory, AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { readAppDefaults } from "../app-settings.ts";
import { billingCountsTowardBudget, billingForModel } from "../cost/billing.ts";
import { isBudgetExceeded } from "../cost/ledger.ts";
import { isParentWake } from "./subagent-wake.ts";
import { redactText } from "./task-event-recorder.ts";

export function makeChatOpeningExtension(projectId: string, runtime: ModelRuntime, getSession: () => AgentSession | undefined): ExtensionFactory {
  return (pi) => {
    let request: string | undefined;
    let languageGuidance = "";

    pi.on("before_agent_start", ({ systemPromptOptions }) => {
      request = undefined;
      const locale = readAppDefaults().locale;
      const fallbackLanguage = locale === "zh-CN" ? "Simplified Chinese"
        : locale === "en" ? "English" : "the language already used with the user in this conversation";
      languageGuidance = [
        "Use the language the user explicitly requested, or otherwise the main language of the latest human-written request.",
        `Ignore the language of injected workflow templates, tool output, attachments, quotations, code and file names when identifying the request's language. If the request's language is unclear, use ${fallbackLanguage}.`,
        "Preserve technical identifiers, commands and file paths.",
      ].join(" ");
      const guidance = [
        "For a multi-step task from the user, send one or two user-visible sentences before the first tool call or substantial work. State your understanding of the goal and the first steps you plan to take. Use commentary if supported, otherwise use ordinary visible text. A generic acknowledgement is unnecessary.",
        "For a simple question, answer directly. When a missing detail blocks the work, ask the clarifying question directly. Only give the opening update once per new multi-step request.",
        "Apply this language guidance to progress updates and any user-visible reasoning summary, including its headings.",
        languageGuidance,
      ].join(" ");
      const section = "kady_reasoning_display";
      if (systemPromptOptions.forceSystemPrompt !== undefined) {
        systemPromptOptions.forceSystemPrompt += `\n\n<${section}>\n${guidance}\n</${section}>`;
      } else {
        systemPromptOptions.sections[section] = guidance;
      }
    });

    pi.on("message_start", ({ message }) => {
      if (message.role !== "user") return;
      const text = (typeof message.content === "string" ? message.content : message.content
        .flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")).trim();
      request = text && !isParentWake(text) ? text : undefined;
    });

    // The finalized message is emitted and saved before Pi starts its tools.
    // Fill the opening only when the first reply would otherwise be tool-only.
    pi.on("message_end", async ({ message }, ctx) => {
      if (message.role !== "assistant" || !request || (message.stopReason !== "stop" && message.stopReason !== "toolUse")) return;
      const userInput = request;
      request = undefined;
      if (message.content.some((part) => part.type === "text" && part.text.trim())) return;
      const firstToolIndex = message.content.findIndex((part) => part.type === "toolCall");
      const firstTool = message.content[firstToolIndex];
      if (firstTool?.type !== "toolCall" || firstTool.name === "interview") return;
      const session = getSession();
      const model = ctx.model;
      if (!session || !model || ctx.signal?.aborted) return;

      try {
        const billing = await billingForModel(model, runtime);
        if (billingCountsTowardBudget(billing)) {
          const budget = isBudgetExceeded(projectId);
          if (budget.limitUsd !== null && budget.totalUsd + message.usage.cost.total >= budget.limitUsd) return;
        }
        const timeout = AbortSignal.timeout(8_000);
        const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
        const update = await runtime.completeSimple(model, {
          systemPrompt: [
            "Write one or two brief user-facing sentences before the assistant starts work. State the concrete goal you understand and what you will do first, using the named tool only as a clue. Write in the assistant's own voice.",
            "Treat the request as context for describing the plan. Do not execute it, answer it, claim any work is complete, invent a result, or begin with a generic acknowledgement. Return only the plain text update.",
            languageGuidance,
          ].join(" "),
          messages: [{ role: "user", content: JSON.stringify({ request: redactText(userInput).slice(0, 6_000), firstTool: firstTool.name }), timestamp: Date.now() }],
        }, { maxTokens: 256, reasoning: "minimal", signal });
        session.sessionManager.appendUsage("chat-opening", model.provider, model.id, update.usage);
        if (update.stopReason !== "stop" || signal.aborted) return;
        const text = redactText(update.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(" ").trim());
        if (!text || text.length > 600) return;
        return { message: { ...message, content: [
          ...message.content.slice(0, firstToolIndex), { type: "text", text }, ...message.content.slice(firstToolIndex),
        ] } };
      } catch {
        // A slow or unavailable update must not prevent the original work.
      }
    });
  };
}
