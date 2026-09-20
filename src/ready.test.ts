import { describe, expect, it } from "vitest";
import { parsePersonasYaml } from "./personas.js";
import { applyReadyToHealth, evaluateBuild, evaluateReady, specHash } from "./ready.js";
import type { Health, JevRun, SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "invoice-approval",
  title: "Invoice approval",
  optional: {},
  businessRules: [
    {
      id: "BR-001",
      title: "Managers approve",
      statement: "A manager may approve.",
      observable: "Approve is available.",
      line: 10,
    },
  ],
  useCases: [
    {
      id: "UC-001",
      title: "Approve",
      actor: "Manager",
      preconditions: "Logged in",
      steps: ["Approve"],
      outcome: "Approved",
      line: 20,
    },
  ],
  matrix: {
    roles: ["Manager"],
    actions: [{ id: "approve-invoice", permissions: { Manager: "allow" }, line: 30 }],
  },
};

const personas = parsePersonasYaml(`personas:
  Manager:
    email: manager@example.test
`);

function run(answers: JevRun["answers"]): JevRun {
  return { specHash: specHash(spec), checkedAt: "2026-01-01T00:00:00.000Z", answers };
}

describe("evaluateReady", () => {
  it("blocks a matrix role with no persona without calling Jev", () => {
    const empty = parsePersonasYaml("personas:\n");
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas: empty,
      hasApiKey: false,
    });
    expect(ready.state).toBe("blocked");
    expect(ready.findings.some((f) => f.message.includes("Manager"))).toBe(true);
  });

  it("stays Not yet when personas are complete and there is no API key", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: false,
    });
    expect(ready.state).toBe("not_yet");
    expect(ready.reason).toBe("no_api_key");
    expect(ready.findings).toEqual([]);
  });

  it("marks Ready after a passing mock run", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "section.score.business-rules", type: "score", score: 2 },
        { id: "section.score.use-cases", type: "score", score: 2 },
        { id: "section.score.roles-permissions", type: "score", score: 2 },
        { id: "pack.next-id", type: "choice", choice: "BR-001" },
        { id: "pack.agent-ready", type: "noul", noul: 0.91 },
      ]),
    });
    expect(ready.state).toBe("ready");
    expect(ready.blockers).toBe(0);
  });

  it("treats a low observable noul as an untestable-rule blocker", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.1 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "pack.agent-ready", type: "noul", noul: 0.91 },
      ]),
    });
    expect(ready.state).toBe("blocked");
    expect(ready.findings.some((f) => f.kind === "untestable_rule")).toBe(true);
  });

  it("treats a high contradiction noul as a blocker", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.9 },
        { id: "pack.agent-ready", type: "noul", noul: 0.91 },
      ]),
    });
    expect(ready.findings.some((f) => f.kind === "matrix_contradiction")).toBe(true);
  });

  it("treats pack noul below 0.75 as a blocker", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "pack.agent-ready", type: "noul", noul: 0.74 },
      ]),
    });
    expect(ready.findings.some((f) => f.kind === "pack_gate")).toBe(true);
    expect(ready.findings[0]?.severity).toBe("blocker");
  });

  it("treats pack noul at or above 0.75 as passing the pack gate", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "pack.agent-ready", type: "noul", noul: 0.75 },
      ]),
    });
    expect(ready.state).toBe("ready");
    expect(ready.findings.some((f) => f.kind === "pack_gate")).toBe(false);
  });
});

function baseHealth(build: Health["build"] = { state: "not_yet" }): Health {
  return {
    requirementId: "invoice-approval",
    spec: { state: "valid", findings: [] },
    ready: { state: "not_yet", reason: "unchecked", blockers: 0, nits: 0, findings: [] },
    build,
    proof: { state: "not_yet" },
    nextAction: { id: "check-jev", label: "Check this spec with Jev", enabled: true },
    howThisIsGoing: "",
  };
}

describe("scoreboard", () => {
  it("prefers Improve nextId when Ready is blocked", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "pack.next-id", type: "choice", choice: "BR-001" },
        { id: "pack.agent-ready", type: "noul", noul: 0.4 },
      ]),
    });
    const health = applyReadyToHealth(baseHealth(), ready);
    expect(health.nextAction.id).toBe("fix-ready");
    expect(health.nextAction.label).toBe("Improve BR-001");
  });

  it("enables Implement when Ready, then Prove after a succeeded build", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: run([
        { id: "rule.observable.BR-001", type: "noul", noul: 0.95 },
        { id: "usecase.contradicts.UC-001", type: "noul", noul: 0.04 },
        { id: "section.score.business-rules", type: "score", score: 2 },
        { id: "section.score.use-cases", type: "score", score: 2 },
        { id: "section.score.roles-permissions", type: "score", score: 2 },
        { id: "pack.agent-ready", type: "noul", noul: 0.91 },
      ]),
    });
    const before = applyReadyToHealth(baseHealth(), ready);
    expect(before.nextAction.id).toBe("implement");
    expect(before.nextAction.enabled).toBe(true);
    const after = applyReadyToHealth(baseHealth({ state: "succeeded", adapter: "manual" }), ready);
    expect(after.nextAction.id).toBe("prove");
    expect(after.nextAction.enabled).toBe(false);
  });
});

describe("evaluateBuild", () => {
  it("marks a hash mismatch stale, except failed runs", () => {
    expect(evaluateBuild(spec, null).state).toBe("not_yet");
    expect(
      evaluateBuild(spec, {
        specHash: specHash(spec),
        state: "succeeded",
        adapter: "manual",
        at: "2026-01-01T00:00:00.000Z",
      }).state,
    ).toBe("succeeded");
    expect(
      evaluateBuild(spec, {
        specHash: "other",
        state: "succeeded",
        adapter: "manual",
        at: "2026-01-01T00:00:00.000Z",
      }).state,
    ).toBe("stale");
    expect(
      evaluateBuild(spec, {
        specHash: "other",
        state: "failed",
        adapter: "cursor",
        at: "2026-01-01T00:00:00.000Z",
      }).state,
    ).toBe("failed");
  });
});
