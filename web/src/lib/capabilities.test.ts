import { afterEach, describe, expect, it, vi } from "vitest";
import * as projects from "@/lib/projects";
import { getAllSkills, setSkillEnabled } from "@/lib/capabilities";

afterEach(() => vi.restoreAllMocks());

describe("capabilities client", () => {
  it("getAllSkills returns the enabled/disabled partition", async () => {
    vi.spyOn(projects, "apiFetch").mockResolvedValue(
      new Response(JSON.stringify({ enabled: [{ id: "a", name: "a", description: "" }], disabled: [] }), {
        status: 200,
      }),
    );
    const listing = await getAllSkills();
    expect(listing.enabled.map((s) => s.name)).toEqual(["a"]);
    expect(listing.disabled).toEqual([]);
    expect(listing.problems).toEqual([]);
  });

  it("getAllSkills passes loader problems through", async () => {
    vi.spyOn(projects, "apiFetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: [],
          disabled: [],
          problems: [{ name: "broken", state: "enabled", loaded: false, message: "bad yaml" }],
        }),
        { status: 200 },
      ),
    );
    const listing = await getAllSkills();
    expect(listing.problems).toEqual([
      { name: "broken", state: "enabled", loaded: false, message: "bad yaml" },
    ]);
  });

  it("setSkillEnabled posts to the enable/disable route and throws detail on error", async () => {
    const spy = vi
      .spyOn(projects, "apiFetch")
      .mockResolvedValue(new Response(JSON.stringify({ detail: "boom" }), { status: 409 }));
    await expect(setSkillEnabled("a", false)).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalledWith("/skills/a/disable", { method: "POST" });
  });
});

it("pins every skill request to its settings project even when the browser's active project changes", async () => {
  const client = await import("./capabilities");
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ content: "skill content", installed: [], conflicts: [] }), { status: 200 }));
  const previous = projects.getActiveProjectId();
  try {
    projects.setActiveProjectId("default");
    const project = "test-178665";
    await client.getAllSkills("project", project);
    await client.previewSkillSource({ source: "owner/repo", scope: "project" }, project);
    // Another tab changes the active project between preview and install.
    projects.setActiveProjectId("other-project");
    await client.installSkills({ source: "owner/repo", names: ["skill-a"], scope: "project", stagingToken: "reviewed", acknowledged: true }, project);
    await client.createSkill({ name: "skill-a", scope: "project" }, project);
    await client.setSkillEnabled("skill-a", true, "project", project);
    await client.getSkillSource("skill-a", "project", project);
    await client.saveSkillSource("skill-a", "original instructions", "project", project);
    await client.checkSkillUpdate("skill-a", "project", project);
    await client.updateSkillFromUpstream("skill-a", "project", project);
    await client.setSkillModelInvocation("skill-a", false, "project", project);
    await client.removeSkill("skill-a", "project", project);
    await client.syncSkills(project);
    expect(fetch).toHaveBeenCalledTimes(12);
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get("X-Project-Id")).toBe(project);
    const install = fetch.mock.calls.find(([url]) => String(url).endsWith("/skills/install"))!;
    expect(JSON.parse(String(install[1]?.body))).toMatchObject({ scope: "project", stagingToken: "reviewed", acknowledged: true });
  } finally {
    projects.setActiveProjectId(previous);
  }
});
