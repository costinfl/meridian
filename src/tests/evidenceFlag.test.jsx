import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { isEvidenceEnabled } from "../evidenceFlag.js";
import { createProject } from "../models/project.js";

describe("isEvidenceEnabled", () => {
  it("is off by default", () => {
    expect(isEvidenceEnabled(createProject("P"), "")).toBe(false);
    expect(isEvidenceEnabled(null, "")).toBe(false);
    expect(isEvidenceEnabled({ people: [] }, "")).toBe(false); // older project without the setting
  });
  it("is on with the project setting", () => {
    expect(isEvidenceEnabled(createProject("P", { settings: { evidenceUi: true } }), "")).toBe(true);
  });
  it("is on with ?evidence=1 only", () => {
    const p = createProject("P");
    expect(isEvidenceEnabled(p, "?evidence=1")).toBe(true);
    expect(isEvidenceEnabled(p, "?x=2&evidence=1")).toBe(true);
    expect(isEvidenceEnabled(p, "?evidence=0")).toBe(false);
    expect(isEvidenceEnabled(p, "?evidence=true")).toBe(false);
  });
  it("new projects carry evidenceUi: false", () => {
    expect(createProject("P").settings.evidenceUi).toBe(false);
  });
});

describe("App entry point", () => {
  beforeEach(() => {
    global.indexedDB = new IDBFactory();
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

  it("hides the Evidence button by default", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    await screen.findByText(/Sources/);
    expect(screen.queryByRole("button", { name: /^Evidence$/ })).toBeNull();
  });

  it("shows the Evidence button with ?evidence=1 and opens the lazy panel", async () => {
    window.history.pushState({}, "", "/?evidence=1");
    const { default: App } = await import("../App.jsx");
    render(<App />);
    const btn = await screen.findByRole("button", { name: /^Evidence$/ });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Evidence" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Evidence" })).toBeNull());
  });
});

describe("evidenceUi toggle in the Projects dialog", () => {
  beforeEach(() => {
    global.indexedDB = new IDBFactory();
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

  it("turns the Evidence button on and off for the open project, without a URL flag", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    await screen.findByText(/Sources/);
    expect(screen.queryByRole("button", { name: /^Evidence$/ })).toBeNull();

    fireEvent.click(screen.getByTitle(/projects/i));
    const box = await screen.findByRole("checkbox", { name: /Evidence layer \(preview\)/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Evidence$/ })).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /Evidence layer \(preview\)/ })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: /Evidence layer \(preview\)/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Evidence$/ })).toBeNull());
  });
});
