import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { isEvidenceEnabled } from "../evidenceFlag.js";
import { createProject } from "../models/project.js";

describe("isEvidenceEnabled (on by default since the Phase 6 review)", () => {
  it("is on by default, also for older projects that saved the old preview setting as off", () => {
    expect(isEvidenceEnabled(createProject("P"), "")).toBe(true);
    expect(isEvidenceEnabled(null, "")).toBe(true);
    expect(isEvidenceEnabled({ people: [], settings: { evidenceUi: false } }, "")).toBe(true);
  });
  it("is off when the project switches it off", () => {
    expect(isEvidenceEnabled(createProject("P", { settings: { evidenceOff: true } }), "")).toBe(false);
  });
  it("the URL can force it for testing", () => {
    const off = createProject("P", { settings: { evidenceOff: true } });
    expect(isEvidenceEnabled(off, "?evidence=1")).toBe(true);
    expect(isEvidenceEnabled(createProject("P"), "?x=2&evidence=0")).toBe(false);
    expect(isEvidenceEnabled(createProject("P"), "?evidence=true")).toBe(true);    // anything else: the project decides
  });
  it("new projects no longer write the old evidenceUi setting", () => {
    expect("evidenceUi" in createProject("P").settings).toBe(false);
  });
});

describe("Evidence page", () => {
  beforeEach(() => {
    global.indexedDB = new IDBFactory();
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

  it("the Evidence button opens its own page (#evidence) in place of the timeline, and goes back", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    const btn = await screen.findByRole("button", { name: /^Evidence$/ });
    expect(screen.queryByTestId("evidence-page")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("evidence-page")).toBeInTheDocument());
    expect(window.location.hash).toBe("#evidence");
    expect(screen.queryByText(/scroll · zoom/)).toBeNull();                         // the timeline board is not shown
    expect(screen.getByRole("navigation", { name: "Evidence sections" }).textContent).toMatch(/Documents.*AI settings/);
    fireEvent.click(screen.getByRole("button", { name: "← Timeline" }));
    await waitFor(() => expect(screen.queryByTestId("evidence-page")).toBeNull());
    expect(window.location.hash).toBe("");
    expect(screen.getByText(/scroll · zoom/)).toBeInTheDocument();
  });

  it("opens directly on #evidence (reload) and follows the Back button", async () => {
    window.history.pushState({}, "", "/#evidence");
    const { default: App } = await import("../App.jsx");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("evidence-page")).toBeInTheDocument());
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.queryByTestId("evidence-page")).toBeNull());
  });

  it("the Projects checkbox switches the layer off and on for the open project", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    await screen.findByRole("button", { name: /^Evidence$/ });
    fireEvent.click(screen.getByTitle(/projects/i));
    const box = await screen.findByRole("checkbox", { name: /Evidence layer/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Evidence$/ })).toBeNull());
    fireEvent.click(screen.getByRole("checkbox", { name: /Evidence layer/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Evidence$/ })).toBeInTheDocument());
  });

  it("the timeline measures its width when it appears after the Evidence page (life lines are drawn; review fix)", async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1400; } });
    try {
      window.history.pushState({}, "", "/#evidence");
      const { default: App } = await import("../App.jsx");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("evidence-page")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "← Timeline" }));
      await waitFor(() => expect(screen.queryByTestId("evidence-page")).toBeNull());
      const lifeLines = () => [...document.querySelectorAll("div[title]")].filter((d) => / · \d{3,4}–/.test(d.title)).length;
      await waitFor(() => expect(lifeLines()).toBeGreaterThan(1));
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, "clientWidth", desc); else delete HTMLElement.prototype.clientWidth;
    }
  });
});
