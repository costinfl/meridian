import { useState, useEffect, useRef, useCallback } from "react";
import { createProject } from "../models/project.js";
import { SAMPLE_PEOPLE, SAMPLE_ANNOTATIONS } from "../sampleData.js";

const AUTOSAVE_MS = 1500;

export function useProject(storage) {
  const [projectList, setProjectList] = useState([]);
  const [project, setProjectState] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const skipAutoSave = useRef(false);
  const latestProject = useRef(null);
  latestProject.current = project;

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = await storage.listProjects();
        if (cancelled) return;

        let loaded;
        if (list.length === 0) {
          const seed = createProject("Hariton Family", {
            people: SAMPLE_PEOPLE,
            annotations: SAMPLE_ANNOTATIONS,
            settings: { focusPersonId: "i1", relativeIds: ["i2", "i5"] },
          });
          await storage.saveProject(seed);
          list = [{ id: seed.id, name: seed.name, updatedAt: seed.updatedAt, personCount: seed.people.length }];
          loaded = seed;
        } else {
          loaded = await storage.loadProject(list[0].id);
        }

        if (!cancelled) {
          skipAutoSave.current = true;
          setProjectState(loaded);
          setProjectList(list);
          setIsDirty(false);
        }
      } catch (err) {
        console.error("Meridian: storage init failed", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever project changes (unless this change was a programmatic load)
  useEffect(() => {
    if (!project) return;
    if (skipAutoSave.current) {
      skipAutoSave.current = false;
      return;
    }
    setIsDirty(true);
    const timer = setTimeout(async () => {
      const p = latestProject.current;
      if (!p) return;
      try {
        await storage.saveProject(p);
        setIsDirty(false);
        const list = await storage.listProjects();
        setProjectList(list);
      } catch (err) {
        console.error("Meridian: auto-save failed", err);
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  // Internal mutator — all user-facing changes go through here
  const mutate = useCallback((updater) => {
    setProjectState((prev) => {
      if (!prev) return prev;
      const patch = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      return { ...patch, updatedAt: new Date().toISOString() };
    });
  }, []);

  // ── Project-level operations ─────────────────────────────────────────────

  const openProject = useCallback(async (id) => {
    try {
      const p = await storage.loadProject(id);
      if (p) {
        skipAutoSave.current = true;
        setProjectState(p);
        setIsDirty(false);
      }
    } catch (err) {
      console.error("Meridian: load project failed", err);
    }
  }, [storage]);

  const createNewProject = useCallback(async (name) => {
    const p = createProject(name);
    await storage.saveProject(p);
    skipAutoSave.current = true;
    setProjectState(p);
    setIsDirty(false);
    const list = await storage.listProjects();
    setProjectList(list);
    return p;
  }, [storage]);

  const saveNow = useCallback(async () => {
    const p = latestProject.current;
    if (!p) return;
    await storage.saveProject(p);
    setIsDirty(false);
    const list = await storage.listProjects();
    setProjectList(list);
  }, [storage]);

  const deleteProject = useCallback(async (id) => {
    await storage.deleteProject(id);
    const list = await storage.listProjects();
    setProjectList(list);
    if (latestProject.current?.id === id) {
      if (list.length > 0) {
        const next = await storage.loadProject(list[0].id);
        skipAutoSave.current = true;
        setProjectState(next ?? null);
        setIsDirty(false);
      } else {
        setProjectState(null);
      }
    }
  }, [storage]);

  const renameProject = useCallback((name) => {
    mutate((prev) => ({ ...prev, name }));
  }, [mutate]);

  // ── Source operations ────────────────────────────────────────────────────

  const addSource = useCallback((source) => {
    mutate((prev) => ({ ...prev, sources: [...(prev.sources ?? []), source] }));
  }, [mutate]);

  const deleteSource = useCallback((id) => {
    mutate((prev) => ({ ...prev, sources: (prev.sources ?? []).filter((s) => s.id !== id) }));
  }, [mutate]);

  // ── Convenience setters (mirror useState API: accept value OR fn) ────────

  const setPeople = useCallback((fn) => {
    mutate((prev) => ({ ...prev, people: typeof fn === "function" ? fn(prev.people) : fn }));
  }, [mutate]);

  const setAnnotations = useCallback((fn) => {
    mutate((prev) => ({ ...prev, annotations: typeof fn === "function" ? fn(prev.annotations) : fn }));
  }, [mutate]);

  const setFocusId = useCallback((id) => {
    mutate((prev) => ({ ...prev, settings: { ...prev.settings, focusPersonId: id } }));
  }, [mutate]);

  const setRelativeIds = useCallback((fn) => {
    mutate((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        relativeIds: typeof fn === "function" ? fn(prev.settings.relativeIds ?? []) : fn,
      },
    }));
  }, [mutate]);

  const setView = useCallback((fn) => {
    mutate((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        view: typeof fn === "function" ? fn(prev.settings.view) : fn,
      },
    }));
  }, [mutate]);

  const setCtxOn = useCallback((fn) => {
    mutate((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ctxOn: typeof fn === "function" ? fn(prev.settings.ctxOn) : fn,
      },
    }));
  }, [mutate]);

  return {
    projectList,
    project,
    isDirty,
    isLoading,
    openProject,
    createProject: createNewProject,
    saveNow,
    deleteProject,
    renameProject,
    addSource,
    deleteSource,
    setPeople,
    setAnnotations,
    setFocusId,
    setRelativeIds,
    setView,
    setCtxOn,
  };
}
