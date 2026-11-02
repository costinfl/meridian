import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { requestPersistence, getStorageStatus, formatBytes, describeStorage } from "../storage/persistence.js";
import EvidencePanel from "../components/evidence/EvidencePanel.jsx";

function stubStorage(impl) {
  Object.defineProperty(globalThis.navigator, "storage", { value: impl, configurable: true });
}
afterEach(() => { cleanup(); stubStorage(undefined); });

describe("requestPersistence", () => {
  it("returns null when the API is missing", async () => {
    stubStorage(undefined);
    expect(await requestPersistence()).toBeNull();
  });
  it("does not re-ask when already persisted", async () => {
    const persist = vi.fn();
    stubStorage({ persisted: async () => true, persist });
    expect(await requestPersistence()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
  it("asks the browser otherwise and reports the answer", async () => {
    stubStorage({ persisted: async () => false, persist: vi.fn(async () => false) });
    expect(await requestPersistence()).toBe(false);
    stubStorage({ persisted: async () => false, persist: vi.fn(async () => true) });
    expect(await requestPersistence()).toBe(true);
  });
  it("swallows errors", async () => {
    stubStorage({ persisted: async () => { throw new Error("x"); }, persist: async () => { throw new Error("x"); } });
    expect(await requestPersistence()).toBeNull();
  });
});

describe("getStorageStatus / describeStorage", () => {
  it("reads persisted, usage and quota", async () => {
    stubStorage({ persisted: async () => false, estimate: async () => ({ usage: 12_300_000, quota: 3_200_000_000 }) });
    expect(await getStorageStatus()).toEqual({ persisted: false, usage: 12_300_000, quota: 3_200_000_000 });
  });
  it("degrades to nulls when unsupported", async () => {
    stubStorage(undefined);
    expect(await getStorageStatus()).toEqual({ persisted: null, usage: null, quota: null });
    expect(describeStorage({ persisted: null, usage: null, quota: null }, undefined))
      .toBe("Persistent storage: not supported by this browser · Last bundle export: never");
  });
  it("formats bytes and the status line", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(12_300_000)).toBe("12.3 MB");
    expect(formatBytes(null)).toBe("unknown");
    const line = describeStorage({ persisted: true, usage: 5_000_000, quota: 2_000_000_000 }, "2026-11-02T10:00:00.000Z");
    expect(line).toContain("Persistent storage: granted");
    expect(line).toContain("Using 5.0 MB of 2.0 GB");
    expect(line).toMatch(/Last bundle export: .*2026/);
    expect(describeStorage({ persisted: false, usage: null, quota: null })).toContain("not granted");
  });
});

describe("EvidencePanel storage line", () => {
  it("shows persistence, usage and the stored last export time", async () => {
    stubStorage({ persisted: async () => false, estimate: async () => ({ usage: 1_000_000, quota: 1_000_000_000 }) });
    const storage = { getSetting: vi.fn(async () => "2026-11-02T10:00:00.000Z") };
    render(<EvidencePanel storage={storage} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("storage-status").textContent).toContain("not granted"));
    expect(storage.getSetting).toHaveBeenCalledWith("lastBundleExportAt");
    expect(screen.getByTestId("storage-status").textContent).toMatch(/Last bundle export: .*2026/);
  });
  it("says never when no export is recorded", async () => {
    stubStorage(undefined);
    render(<EvidencePanel storage={{ getSetting: async () => undefined }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("storage-status").textContent).toContain("Last bundle export: never"));
  });
});
