import { describe, expect, it } from "vitest";
import { emitProofReport } from "./proof-report.js";
import { specHash } from "./ready.js";
import type { ProofRun, QaPlan, SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "invoice-approval",
  title: "Invoice approval",
  optional: {},
  businessRules: [],
  useCases: [
    {
      id: "UC-001",
      title: "Assigned manager approves a department invoice",
      actor: "Manager",
      preconditions: "The manager is logged in.",
      steps: ["Open the invoice", "Choose Approve"],
      outcome: "The Status label shows Approved.",
      line: 1,
    },
    {
      id: "UC-002",
      title: "Viewer tries to approve",
      actor: "Viewer",
      preconditions: "The viewer is logged in.",
      steps: ["Look for Approve"],
      outcome: "Approve is absent or disabled.",
      line: 2,
    },
  ],
  matrix: { roles: ["Manager", "Viewer"], actions: [] },
};

const plan: QaPlan = {
  requirementId: "invoice-approval",
  specHash: specHash(spec),
  cases: [
    {
      id: "UC-001",
      specId: "UC-001",
      kind: "allow",
      actor: "Manager",
      control: "Approve",
      steps: ["Open the invoice", "Choose Approve"],
      preconditions: "The manager is logged in.",
      outcome: "The Status label shows Approved.",
    },
    {
      id: "UC-002",
      specId: "UC-002",
      kind: "deny",
      actor: "Viewer",
      control: "Approve",
      steps: ["Look for Approve"],
      preconditions: "The viewer is logged in.",
      outcome: "Approve is absent or disabled.",
    },
  ],
};

describe("emitProofReport", () => {
  it("lists failures first and quotes the pack words", () => {
    const run: ProofRun = {
      specHash: specHash(spec),
      checkedAt: "2026-09-24T10:18:03.123Z",
      boot: { ok: true },
      cases: [
        {
          id: "UC-001",
          kind: "allow",
          verdict: "pass",
          noul: 0.91,
          message: "The Status label shows Approved.",
        },
        {
          id: "UC-002",
          kind: "deny",
          verdict: "fail",
          message: "Approve was available and enabled for Viewer; deny failed.",
        },
      ],
    };
    const report = emitProofReport({
      spec,
      plan,
      run,
      ready: { state: "ready", packNoul: 0.75 },
      baseUrl: "http://127.0.0.1:3000",
    });
    expect(report.indexOf("## Failed")).toBeLessThan(report.indexOf("## Passed"));
    expect(report.indexOf("UC-002")).toBeLessThan(report.indexOf("UC-001 —"));
    expect(report).toContain("# Proof report — invoice-approval");
    expect(report).toContain("Result: **Failed — 1 passed, 1 failed**");
    expect(report).toContain("Ready: ready · 0.75");
    expect(report).toContain("Runtime: http://127.0.0.1:3000");
    expect(report).toContain("### UC-002 — Viewer tries to approve");
    expect(report).toContain("1. Open the invoice");
    expect(report).toContain("2. Choose Approve");
    expect(report).toContain("Expected: The Status label shows Approved.");
    expect(report).toContain("Confidence (noul): 0.91");
    expect(report).not.toContain("test-only-not-production");
  });

  it("reports a boot failure without inventing cases", () => {
    const run: ProofRun = {
      specHash: specHash(spec),
      checkedAt: "2026-09-24T10:18:03.123Z",
      boot: { ok: false, message: "App did not boot or accept deterministic login." },
      cases: [],
    };
    const report = emitProofReport({ spec, plan, run });
    expect(report).toContain("Failed — app did not boot");
    expect(report).toContain("No cases were run.");
    expect(report).not.toContain("## Failed");
    expect(report).not.toContain("### UC-001");
  });
});
