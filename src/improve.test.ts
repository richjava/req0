import { describe, expect, it } from "vitest";
import {
  assertImproveAllowed,
  emitImproveBrief,
  ImproveLockedError,
  improveAllowed,
  improveFindings,
  improveHint,
} from "./improve.js";
import { improvePrompt } from "./implement.js";
import { applyReadyToHealth } from "./ready.js";
import type { Health, ReadyFinding, ReadyMeter, SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "invoice-approval",
  title: "Invoice approval",
  optional: {},
  businessRules: [{ id: "BR-001", title: "A", statement: "s", observable: "o", line: 1 }],
  useCases: [
    {
      id: "UC-001",
      title: "Allow",
      actor: "Manager",
      preconditions: "Logged in",
      steps: ["Choose Approve"],
      outcome: "Approved",
      line: 2,
    },
  ],
  matrix: {
    roles: ["Manager"],
    actions: [{ id: "approve-invoice", permissions: { Manager: "allow" }, line: 3 }],
  },
};

const untestable: ReadyFinding = {
  id: "ready.untestable.BR-001",
  kind: "untestable_rule",
  severity: "blocker",
  message: "BR-001 is not testable.",
  specId: "BR-001",
};

const packGate: ReadyFinding = {
  id: "ready.pack-gate",
  kind: "pack_gate",
  severity: "blocker",
  message: "Pack noul 0.69 is below the 0.75 gate.",
  noul: 0.69,
};

const nit: ReadyFinding = {
  id: "ready.section",
  kind: "section_score",
  severity: "nit",
  message: "partial",
  specId: "Business Rules",
};

function ready(findings: ReadyFinding[], extra: Partial<ReadyMeter> = {}): ReadyMeter {
  return {
    state: extra.state ?? "blocked",
    reason: extra.reason ?? "blockers",
    blockers: findings.filter((finding) => finding.severity === "blocker").length,
    nits: findings.filter((finding) => finding.severity === "nit").length,
    findings,
    jevCurrent: extra.jevCurrent ?? true,
    packNoul: extra.packNoul,
    alreadyImproved: extra.alreadyImproved,
    nextId: extra.nextId,
  };
}

describe("improve pass", () => {
  it("includes pack-gate and section nits in one pass", () => {
    const meter = ready([packGate, nit, untestable], { packNoul: 0.69 });
    expect(improveAllowed(meter)).toBe(true);
    expect(improveFindings(meter).map((finding) => finding.id)).toEqual([
      "ready.pack-gate",
      "ready.section",
      "ready.untestable.BR-001",
    ]);
    expect(improveHint(meter)).toMatch(/0\.75/);
  });

  it("hides Improve after Ready when pack noul meets the gate", () => {
    const meter = ready([nit], { state: "ready", reason: "passed", packNoul: 0.79, jevCurrent: true });
    expect(improveAllowed(meter)).toBe(false);
  });

  it("allows Improve for a missing persona before Jev", () => {
    const persona: ReadyFinding = {
      id: "persona.missing.Viewer",
      kind: "persona_missing",
      severity: "blocker",
      message: "Role Viewer has no persona.",
      specId: "Viewer",
    };
    expect(improveAllowed(ready([persona], { jevCurrent: false, packNoul: undefined }))).toBe(true);
  });

  it("asks for Check after a pass was accepted, until the next Jev run", () => {
    const meter = ready([packGate, untestable], {
      packNoul: 0.69,
      alreadyImproved: ["ready.pack-gate", "ready.untestable.BR-001", "BR-001"],
    });
    expect(improveFindings(meter)).toEqual([]);
    expect(improveAllowed(meter)).toBe(false);
    const health = applyReadyToHealth(
      {
        requirementId: "invoice-approval",
        spec: { state: "valid", findings: [] },
        ready: meter,
        build: { state: "not_yet" },
        proof: { state: "not_yet", runtime: false, findings: [] },
        nextAction: { id: "improve", label: "Improve it", enabled: true },
        howThisIsGoing: "",
      } satisfies Health,
      meter,
    );
    expect(health.stages?.ready).toMatchObject({ id: "check-jev", enabled: true });
    expect(health.stages?.ready.hint).toMatch(/same findings/);
  });

  it("writes one opinionated brief for every open finding", () => {
    const brief = emitImproveBrief({
      spec,
      ready: ready([packGate, untestable], { packNoul: 0.69 }),
    });
    expect(brief).toContain("Opinionated writer pass");
    expect(brief).toContain("Pack noul is 0.69");
    expect(brief).toContain("ready.pack-gate");
    expect(brief).toContain("BR-001");
    expect(brief).toContain("Statement: s");
    expect(brief).toContain("one pack pass");
    expect(brief).toContain("Do not invent spec IDs");
    expect(brief).toContain("agent-questions.json");
    expect(brief).not.toContain("Do not interview the owner");
    expect(brief).not.toContain("Owner answers");
    expect(brief).not.toContain("Patch only this finding");
  });

  it("refuses Improve when Ready and pack noul is at the gate", () => {
    expect(() =>
      assertImproveAllowed(ready([], { state: "ready", reason: "passed", packNoul: 0.75, findings: [] })),
    ).toThrow(ImproveLockedError);
  });

  it("puts the improve brief path in the Cursor prompt", () => {
    expect(improvePrompt("/repo/docs/requirements/pack/derived/improve-brief.md")).toContain(
      "/repo/docs/requirements/pack/derived/improve-brief.md",
    );
    expect(improvePrompt("/repo/docs/requirements/pack/derived/improve-brief.md")).toContain(
      "agent-questions.json",
    );
  });
});
