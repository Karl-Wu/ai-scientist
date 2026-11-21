import { describe, it, expect, afterEach } from "vitest";
import factory from "../pi-packages/kady-notebook/index.ts";

/** Minimal ExtensionAPI stub capturing registerTool calls. */
function fakePi() {
  const registered: unknown[] = [];
  return { registered, api: { registerTool: (t: unknown) => registered.push(t) } };
}

const origChild = process.env.PI_SUBAGENT_CHILD;
afterEach(() => {
  if (origChild === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = origChild;
});

describe("kady-notebook package", () => {
  it("registers only read-only notebook search in a child process", () => {
    process.env.PI_SUBAGENT_CHILD = "1";
    const child = fakePi();
    factory(child.api as never);
    expect(child.registered.map((tool) => (tool as { name: string }).name)).toEqual(["notebook_search"]);

    delete process.env.PI_SUBAGENT_CHILD;
    const parent = fakePi();
    factory(parent.api as never);
    expect(parent.registered).toHaveLength(0);
  });
});
