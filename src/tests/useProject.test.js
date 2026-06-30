import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProject } from "../hooks/useProject.js";
import { createProject } from "../models/project.js";

const AUTOSAVE_MS = 1500;

function makeFakeStorage(initial = []) {
  const store = new Map(initial.map((p) => [p.id, p]));
  return {
    listProjects: vi.fn(async () =>
      [...store.values()]
        .map(({ id, name, updatedAt, people }) => ({
          id, name, updatedAt,
          personCount: people?.length ?? 0,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    ),
    loadProject: vi.fn(async (id) => store.get(id) ?? null),
    saveProject: vi.fn(async (p) => { store.set(p.id, p); }),
    deleteProject: vi.fn(async (id) => { store.delete(id); }),
    saveBlob: vi.fn(),
    loadBlob: vi.fn(),
    deleteBlob: vi.fn(),
  };
}

// Flush all pending microtasks (multiple passes for chained awaits)
async function flushAsync() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
}

describe("useProject – initialisation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("seeds a default project when storage is empty and does not mark dirty", async () => {
    const storage = makeFakeStorage([]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.project).not.toBeNull();
    expect(result.current.isDirty).toBe(false);
    // Seed saved exactly once
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
  });

  it("loads an existing project and exposes it in state", async () => {
    const existing = createProject("Hariton Family");
    const storage = makeFakeStorage([existing]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync();

    expect(result.current.project?.name).toBe("Hariton Family");
    expect(result.current.isDirty).toBe(false);
  });

  it("exposes all projects in projectList", async () => {
    const a = createProject("A");
    const b = createProject("B");
    const storage = makeFakeStorage([a, b]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync();

    expect(result.current.projectList).toHaveLength(2);
  });
});

describe("useProject – skipAutoSave prevents save loops on load", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does NOT call saveProject when loading an existing project", async () => {
    const existing = createProject("My Project");
    const storage = makeFakeStorage([existing]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync();

    expect(result.current.isDirty).toBe(false);

    // Advance well past the autosave debounce — still no save
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS + 500); });
    await flushAsync();

    expect(storage.saveProject).not.toHaveBeenCalled();
  });

  it("autosaves after a user mutation but not before", async () => {
    const existing = createProject("My Project");
    const storage = makeFakeStorage([existing]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync();

    // Trigger a mutation
    act(() => { result.current.renameProject("Renamed"); });

    expect(result.current.isDirty).toBe(true);
    expect(storage.saveProject).not.toHaveBeenCalled(); // still debouncing

    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS + 100); });
    await flushAsync();

    expect(storage.saveProject).toHaveBeenCalledOnce();
    const saved = storage.saveProject.mock.calls[0][0];
    expect(saved.name).toBe("Renamed");
    expect(result.current.isDirty).toBe(false);
  });
});

describe("useProject – openProject", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("restores state from storage and clears dirty flag", async () => {
    const projectA = createProject("Project A");
    const projectB = { ...createProject("Project B"), updatedAt: new Date(Date.now() + 5000).toISOString() };
    const storage = makeFakeStorage([projectA, projectB]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync(); // loads projectB (newest)
    expect(result.current.project?.name).toBe("Project B");

    await act(async () => { await result.current.openProject(projectA.id); });
    await flushAsync();

    expect(result.current.project?.name).toBe("Project A");
    expect(result.current.isDirty).toBe(false);
  });

  it("suppresses autosave after openProject (skipAutoSave)", async () => {
    const projectA = createProject("A");
    const projectB = { ...createProject("B"), updatedAt: new Date(Date.now() + 5000).toISOString() };
    const storage = makeFakeStorage([projectA, projectB]);
    const { result } = renderHook(() => useProject(storage));

    await flushAsync(); // loads B

    await act(async () => { await result.current.openProject(projectA.id); });
    await flushAsync();

    // Advance past debounce — openProject sets skipAutoSave, so no save should fire
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS + 500); });
    await flushAsync();

    expect(storage.saveProject).not.toHaveBeenCalled();
  });
});

describe("useProject – data mutations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("setPeople replaces the people array", async () => {
    const storage = makeFakeStorage([createProject("Test")]);
    const { result } = renderHook(() => useProject(storage));
    await flushAsync();

    const newPeople = [{ id: "p1", name: "Alice" }];
    act(() => { result.current.setPeople(newPeople); });

    expect(result.current.project?.people).toEqual(newPeople);
  });

  it("setFocusId updates settings.focusPersonId", async () => {
    const storage = makeFakeStorage([createProject("Test")]);
    const { result } = renderHook(() => useProject(storage));
    await flushAsync();

    act(() => { result.current.setFocusId("p99"); });

    expect(result.current.project?.settings.focusPersonId).toBe("p99");
  });

  it("setView updates settings.view", async () => {
    const storage = makeFakeStorage([createProject("Test")]);
    const { result } = renderHook(() => useProject(storage));
    await flushAsync();

    act(() => { result.current.setView({ left: 1900, ppy: 6.5 }); });

    expect(result.current.project?.settings.view).toEqual({ left: 1900, ppy: 6.5 });
  });

  it("addSource appends to the sources array", async () => {
    const storage = makeFakeStorage([createProject("Test")]);
    const { result } = renderHook(() => useProject(storage));
    await flushAsync();

    const src = { id: "s1", title: "Doc", type: "document" };
    act(() => { result.current.addSource(src); });

    expect(result.current.project?.sources).toContainEqual(src);
  });

  it("deleteSource removes by id", async () => {
    const p = createProject("Test");
    p.sources = [{ id: "s1", title: "A" }, { id: "s2", title: "B" }];
    const storage = makeFakeStorage([p]);
    const { result } = renderHook(() => useProject(storage));
    await flushAsync();

    act(() => { result.current.deleteSource("s1"); });

    expect(result.current.project?.sources).toHaveLength(1);
    expect(result.current.project?.sources[0].id).toBe("s2");
  });
});