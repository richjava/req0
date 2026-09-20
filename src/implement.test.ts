import { describe, expect, it } from "vitest";
import { adapterInstructions, assertImplementAllowed, ImplementLockedError, launchAdapter } from "./implement.js";
import { emptyReady } from "./ready.js";
import type { CompileResult } from "./types.js";

function result(readyState: "not_yet" | "ready"): CompileResult {
  return {
    spec: null,
    markdown: "",
    health: {
      requirementId: "demo",
      spec: { state: "valid", findings: [] },
      ready:
        readyState === "ready"
          ? { state: "ready", reason: "passed", blockers: 0, nits: 0, findings: [] }
          : emptyReady("no_api_key"),
      build: { state: "not_yet" },
      proof: { state: "not_yet" },
      nextAction: { id: "implement", label: "Implement this requirement", enabled: true },
      howThisIsGoing: "",
    },
  };
}

describe("implement lock", () => {
  it("refuses when Ready is not Ready", () => {
    expect(() => assertImplementAllowed(result("not_yet"))).toThrow(ImplementLockedError);
    try {
      assertImplementAllowed(result("not_yet"));
    } catch (err) {
      expect(err).toBeInstanceOf(ImplementLockedError);
      expect((err as ImplementLockedError).code).toBe("ready_gate");
    }
  });

  it("allows launch when Ready is Ready", () => {
    expect(() => assertImplementAllowed(result("ready"))).not.toThrow();
  });

  it("describes both adapters", () => {
    expect(adapterInstructions("cursor", "derived/implement-brief.md")).toContain("Cursor");
    expect(adapterInstructions("manual", "derived/implement-brief.md")).toContain("any coding agent");
  });

  it("manual adapter always succeeds; Cursor needs a product repo", async () => {
    await expect(launchAdapter("manual", null)).resolves.toMatchObject({ ok: true });
    await expect(launchAdapter("cursor", null)).resolves.toMatchObject({ ok: false });
  });
});
