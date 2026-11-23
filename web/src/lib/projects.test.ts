import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

describe("projects.ts", () => {
  let projectsModule: typeof import("./projects");
  const projectKey = "kady:activeProjectId";

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Clear all cookies.
    document.cookie
      .split(";")
      .forEach((c) => {
        const name = c.split("=")[0].trim();
        if (name) {
          document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
      });
    projectsModule = await import("./projects");
  });

  describe("getActiveProjectId / setActiveProjectId", () => {
    it("returns DEFAULT_PROJECT_ID when storage is empty", () => {
      expect(projectsModule.getActiveProjectId()).toBe(
        projectsModule.DEFAULT_PROJECT_ID
      );
    });

    it("keeps this tab's selection after reload even when another tab has chosen a different project", async () => {
      projectsModule.setActiveProjectId("my-proj");
      expect(window.sessionStorage.getItem(projectKey)).toBe("my-proj");
      expect(window.localStorage.getItem(projectKey)).toBe("my-proj");

      window.localStorage.setItem(projectKey, "other-tab");
      vi.resetModules();
      const reloaded = await import("./projects");
      expect(reloaded.getActiveProjectId()).toBe("my-proj");
    });

    it("falls back to default when id is empty", () => {
      projectsModule.setActiveProjectId("   ");
      expect(projectsModule.getActiveProjectId()).toBe(
        projectsModule.DEFAULT_PROJECT_ID
      );
    });

    it("does not write a shared project cookie", () => {
      projectsModule.setActiveProjectId("cookie-proj");
      expect(document.cookie).not.toContain("kady-project=");
    });

    it("uses the shared last choice to initialize a new tab once", () => {
      window.localStorage.setItem(projectKey, "  spaced  ");
      expect(projectsModule.getActiveProjectId()).toBe("spaced");
      expect(window.sessionStorage.getItem(projectKey)).toBe("spaced");
      window.localStorage.setItem(projectKey, "another-project");
      expect(projectsModule.getActiveProjectId()).toBe("spaced");
    });
  });

  describe("onProjectChange", () => {
    it("invokes the handler when setActiveProjectId is called", () => {
      const handler = vi.fn();
      const unsubscribe = projectsModule.onProjectChange(handler);
      projectsModule.setActiveProjectId("new-id");
      expect(handler).toHaveBeenCalledWith("new-id");
      unsubscribe();
    });

    it("stops receiving events after unsubscribe", () => {
      const handler = vi.fn();
      const unsubscribe = projectsModule.onProjectChange(handler);
      unsubscribe();
      projectsModule.setActiveProjectId("after-unsub");
      expect(handler).not.toHaveBeenCalled();
    });

    it("ignores a project selection from another browser tab", () => {
      projectsModule.setActiveProjectId("my-tab");
      const handler = vi.fn();
      const unsubscribe = projectsModule.onProjectChange(handler);
      window.localStorage.setItem(projectKey, "other-tab");
      window.dispatchEvent(new StorageEvent("storage", {
        key: projectKey, oldValue: "my-tab", newValue: "other-tab",
      }));
      expect(handler).not.toHaveBeenCalled();
      expect(projectsModule.getActiveProjectId()).toBe("my-tab");
      unsubscribe();
    });
  });

  describe("apiFetch", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("prepends API_BASE and injects X-Project-Id", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      projectsModule.setActiveProjectId("scoped");
      window.localStorage.setItem(projectKey, "other-tab");
      await projectsModule.apiFetch("/projects");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/projects$/);
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get("X-Project-Id")).toBe("scoped");
    });

    it("does not override an explicit X-Project-Id header", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await projectsModule.apiFetch("/x", {
        headers: { "X-Project-Id": "explicit" },
      });

      const headers = new Headers(
        (fetchMock.mock.calls[0][1] as RequestInit).headers
      );
      expect(headers.get("X-Project-Id")).toBe("explicit");
    });

    it("pins a request to an inactive workspace project", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      projectsModule.setActiveProjectId("visible-project");
      await projectsModule.apiFetch("/sessions/background/run", {}, "background-project");

      const headers = new Headers(
        (fetchMock.mock.calls[0][1] as RequestInit).headers,
      );
      expect(headers.get("X-Project-Id")).toBe("background-project");
    });

    it("uses a separate loopback connection pool for SSE streams", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await projectsModule.apiFetch("/sessions/live/run", {}, "project-a", "stream");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://127.0.0.1:8000/sessions/live/run",
      );
      const headers = new Headers(
        (fetchMock.mock.calls[0][1] as RequestInit).headers,
      );
      expect(headers.get("X-Project-Id")).toBe("project-a");
    });

    it("passes absolute URLs through untouched", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await projectsModule.apiFetch("https://example.org/foo");
      expect(fetchMock.mock.calls[0][0]).toBe("https://example.org/foo");
    });
  });

  describe("CRUD wrappers", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("listProjects parses JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: "x", name: "X" }]), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);
      const result = await projectsModule.listProjects();
      expect(result).toEqual([{ id: "x", name: "X" }]);
    });

    it("listProjects throws on non-ok responses", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("nope", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(projectsModule.listProjects()).rejects.toThrow(/500/);
    });

    it("listProjectActivities parses the lightweight status map", async () => {
      const activities = {
        alpha: { running: 1, needsInput: 0, errors: 0, blocked: 0, done: 0 },
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ activities }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(projectsModule.listProjectActivities()).resolves.toEqual(activities);
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects\/activity$/);
    });

    it("createProject serialises the input as JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "new", name: "N" }), { status: 201 })
      );
      vi.stubGlobal("fetch", fetchMock);
      await projectsModule.createProject({ name: "N" });
      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).body).toBe(JSON.stringify({ name: "N" }));
    });

    it("deleteProject tolerates 204 responses", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        projectsModule.deleteProject("abc")
      ).resolves.toBeUndefined();
    });

    it("patchProject passes id via URL and body via JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "a", description: "x" }), {
          status: 200,
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      await projectsModule.patchProject("a", { description: "x" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/projects/a");
      expect((init as RequestInit).method).toBe("PATCH");
    });
  });
});
