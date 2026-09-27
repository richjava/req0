import { describe, expect, it } from "vitest";
import {
  assertFixFromProofAllowed,
  emitFixFromProofBrief,
  fixFromProofAllowed,
  FixFromProofLockedError,
} from "./fix-from-proof.js";
import { emptyReady } from "./ready.js";
import type { Health, ProofMeter, SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "demo-pack",
  title: "Demo",
  optional: {},
  businessRules: [],
  useCases: [],
  matrix: { roles: ["Admin"], actions: [] },
};

function health(proof: ProofMeter, build: Health["build"] = { state: "succeeded" }): Health {
  return {
    requirementId: "demo-pack",
    spec: { state: "valid", findings: [] },
    ready: { ...emptyReady("passed"), state: "ready" },
    build,
    proof,
    nextAction: { id: "prove", label: "Prove", enabled: true },
    howThisIsGoing: "",
  };
}

describe("fixFromProofAllowed", () => {
  it("is on after a succeeded build and a failed or review proof", () => {
    expect(
      fixFromProofAllowed(
        health({ state: "failed", runtime: true, findings: [], message: "3 failed" }),
      ),
    ).toBe(true);
    expect(
      fixFromProofAllowed(health({ state: "needs_review", runtime: true, findings: [] })),
    ).toBe(true);
    expect(fixFromProofAllowed(health({ state: "passed", runtime: true, findings: [] }))).toBe(false);
    expect(fixFromProofAllowed(health({ state: "stale", runtime: true, findings: [] }))).toBe(false);
    expect(
      fixFromProofAllowed(
        health({ state: "failed", runtime: true, findings: [] }, { state: "not_yet" }),
      ),
    ).toBe(false);
    expect(
      fixFromProofAllowed(
        health({ state: "failed", runtime: true, findings: [] }, { state: "succeeded", owned: false }),
      ),
    ).toBe(false);
  });

  it("throws when the gate is closed", () => {
    expect(() =>
      assertFixFromProofAllowed(health({ state: "passed", runtime: true, findings: [] })),
    ).toThrow(FixFromProofLockedError);
  });
});

describe("emitFixFromProofBrief", () => {
  it("points at the proof report and forbids a spec edit", () => {
    const brief = emitFixFromProofBrief({
      spec,
      proof: {
        state: "failed",
        runtime: true,
        findings: [
          { id: "proof.outcome.UC-001", specId: "UC-001", severity: "fail", message: "Approve was not available." },
        ],
      },
      reportPath: "derived/proof-report.md",
      implementBriefPath: "derived/implement-brief.md",
    });
    expect(brief).toContain("derived/proof-report.md");
    expect(brief).toContain("derived/implement-brief.md");
    expect(brief).toContain("UC-001");
    expect(brief).toContain("Do not edit `requirement.md`");
    expect(brief).toContain("At most 3 `npx ampx sandbox --once` deploys");
    expect(brief).not.toContain("Improve it");
  });
});
