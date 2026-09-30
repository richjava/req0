import { describe, expect, it } from "vitest";
import { parsePersonasYaml } from "./personas.js";
import {
  applyReadyToHealth,
  evaluateBuild,
  evaluateReady,
  followImplementPid,
  followedImplementPids,
  IMPLEMENT_INTERRUPTED,
  specHash,
  unfollowImplementPid,
} from "./ready.js";
import { readyBadge } from "./stages.js";
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
    expect(ready.jevCurrent).toBe(true);
    expect(ready.packNoul).toBe(0.91);
    expect(readyBadge(ready)).toBe("Clear · 0.91");
  });

  it("drops a jev-run whose specHash does not match and hides noul", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: {
        specHash: "other",
        checkedAt: "2026-01-01T00:00:00.000Z",
        answers: [{ id: "pack.agent-ready", type: "noul", noul: 0.91 }],
      },
    });
    expect(ready.state).toBe("not_yet");
    expect(ready.reason).toBe("unchecked");
    expect(ready.jevCurrent).toBe(false);
    expect(ready.packNoul).toBeUndefined();
    expect(readyBadge(ready)).toBe("Not yet");
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
    proof: { state: "not_yet", runtime: false, findings: [] },
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
    expect(health.nextAction.id).toBe("improve");
    expect(health.nextAction.label).toBe("Improve it");
    expect(health.stages?.ready).toMatchObject({ id: "improve", enabled: true });
    expect(health.howThisIsGoing).toMatch(/Improve it can raise pack noul/);
    expect(health.stages?.build.enabled).toBe(false);
  });

  it("shows Check after a hash mismatch and locks Implement until Ready", () => {
    const ready = evaluateReady({
      spec,
      specState: "valid",
      personas,
      hasApiKey: true,
      jevRun: { specHash: "stale", checkedAt: "2026-01-01T00:00:00.000Z", answers: [] },
    });
    const health = applyReadyToHealth(baseHealth(), ready);
    expect(health.stages?.ready).toMatchObject({ id: "check-jev", label: "Check", enabled: true });
    expect(health.nextAction.id).toBe("check-jev");
    expect(health.stages?.build.enabled).toBe(false);
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
    expect(before.stages?.ready.enabled).toBe(false);
    expect(before.stages?.build).toMatchObject({ id: "implement", label: "Implement", enabled: true });
    const running = applyReadyToHealth(baseHealth({ state: "running" }), ready);
    expect(running.nextAction).toMatchObject({ id: "stop-implement", label: "Stop", enabled: true });
    expect(running.stages?.build.label).toBe("Implementing");
    expect(running.stages?.build.enabled).toBe(false);
    expect(running.stages?.stopImplement).toMatchObject({ id: "stop-implement", enabled: true });
    expect(running.howThisIsGoing).toMatch(/Stop ends the run/);
    const waiting = applyReadyToHealth({ ...baseHealth(), build: { state: "not_yet", needsStack: true } }, ready);
    expect(waiting.nextAction.id).toBe("implement");
    expect(waiting.nextAction.enabled).toBe(false);
    expect(waiting.stages?.build.hint).toMatch(/req0\.json/);
    const after = applyReadyToHealth(baseHealth({ state: "succeeded", adapter: "manual" }), ready);
    expect(after.nextAction.id).toBe("prove");
    expect(after.nextAction.enabled).toBe(false);
    const withRuntime = applyReadyToHealth(
      {
        ...baseHealth({ state: "succeeded", adapter: "manual" }),
        proof: { state: "not_yet", runtime: true, findings: [] },
      },
      ready,
    );
    expect(withRuntime.nextAction.id).toBe("prove");
    expect(withRuntime.nextAction.enabled).toBe(true);
    expect(withRuntime.stages?.build.label).toBe("Reimplement");
    expect(withRuntime.stages?.proof.label).toBe("Prove");
    expect(withRuntime.howThisIsGoing).toBe("");
    const reprove = applyReadyToHealth(
      {
        ...baseHealth({ state: "succeeded", adapter: "manual" }),
        proof: { state: "passed", runtime: true, findings: [] },
      },
      ready,
    );
    expect(reprove.stages?.proof.label).toBe("Re-prove");
    expect(reprove.nextAction.id).toBe("prove");
    const failedProof = applyReadyToHealth(
      {
        ...baseHealth({ state: "succeeded", adapter: "manual" }),
        proof: {
          state: "failed",
          runtime: true,
          findings: [{ id: "proof.outcome.UC-001", specId: "UC-001", severity: "fail", message: "Approve missing." }],
          message: "3 failed",
        },
      },
      ready,
    );
    expect(failedProof.nextAction).toMatchObject({ id: "fix-from-proof", label: "Fix from proof", enabled: true });
    expect(failedProof.stages?.build.label).toBe("Reimplement");
    expect(failedProof.howThisIsGoing).toMatch(/Fix from proof/);
    const proved = applyReadyToHealth(
      {
        ...baseHealth({
          state: "succeeded",
          adapter: "cursor",
          message:
            "Started a Cursor agent with the implement brief. Watch the product repo for new files. Build Succeeded is not proof the app boots.",
        }),
        proof: { state: "passed", runtime: true, findings: [] },
      },
      ready,
    );
    expect(proved.howThisIsGoing).toBe("");
  });

  it("offers Ignore on a failed Build and unlocks Prove after it", () => {
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
    const failed = applyReadyToHealth(
      {
        ...baseHealth({ state: "failed", message: IMPLEMENT_INTERRUPTED }),
        proof: { state: "not_yet", runtime: true, findings: [] },
      },
      ready,
    );
    expect(failed.nextAction.id).toBe("implement");
    expect(failed.stages?.proof.enabled).toBe(false);
    expect(failed.stages?.ignoreBuild).toMatchObject({ id: "ignore-build", label: "Ignore", enabled: true });
    const ignoredFailed = applyReadyToHealth(
      {
        ...baseHealth({ state: "failed", ignored: true, message: IMPLEMENT_INTERRUPTED }),
        proof: { state: "not_yet", runtime: true, findings: [] },
      },
      ready,
    );
    expect(ignoredFailed.nextAction.id).toBe("prove");
    expect(ignoredFailed.nextAction.enabled).toBe(true);
    expect(ignoredFailed.stages?.ignoreBuild).toBeUndefined();
    expect(ignoredFailed.stages?.proof.enabled).toBe(true);
    const markedOk = applyReadyToHealth(
      {
        ...baseHealth({ state: "succeeded", ignored: true, message: "Owner marked Build successful after Ignore." }),
        proof: { state: "not_yet", runtime: true, findings: [] },
      },
      ready,
    );
    expect(markedOk.build.state).toBe("succeeded");
    expect(markedOk.nextAction.id).toBe("prove");
    expect(markedOk.stages?.ignoreBuild).toBeUndefined();
  });

  it("skips Implement and enables Prove when Build is not owned", () => {
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
    const health = applyReadyToHealth(
      {
        ...baseHealth({ state: "not_yet", owned: false, message: "Implement is off in req0.json." }),
        proof: { state: "not_yet", runtime: true, findings: [] },
      },
      ready,
    );
    expect(health.stages?.build).toMatchObject({ id: "implement", enabled: false, hidden: true });
    expect(health.nextAction.id).toBe("prove");
    expect(health.nextAction.enabled).toBe(true);
    expect(health.howThisIsGoing).toBe("");
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
    expect(
      evaluateBuild(spec, {
        specHash: specHash(spec),
        state: "failed",
        adapter: "cursor",
        at: "2026-01-01T00:00:00.000Z",
        ignored: true,
        message: IMPLEMENT_INTERRUPTED,
      }),
    ).toMatchObject({ state: "failed", ignored: true });
  });

  it("does not keep a running stamp after this process stops following the agent", () => {
    expect(
      evaluateBuild(spec, {
        specHash: specHash(spec),
        state: "running",
        adapter: "cursor",
        at: "2026-01-01T00:00:00.000Z",
      }).state,
    ).toBe("failed");
    expect(
      evaluateBuild(spec, {
        specHash: specHash(spec),
        state: "running",
        adapter: "cursor",
        at: "2026-01-01T00:00:00.000Z",
      }).message,
    ).toBe(IMPLEMENT_INTERRUPTED);
    followImplementPid(4242);
    try {
      expect(
        evaluateBuild(spec, {
          specHash: specHash(spec),
          state: "running",
          adapter: "cursor",
          at: "2026-01-01T00:00:00.000Z",
          pid: 4242,
        }).state,
      ).toBe("running");
    } finally {
      unfollowImplementPid(4242);
      followedImplementPids.clear();
    }
  });

  it("keeps a waiting-on-questions stamp running without a followed pid", () => {
    expect(
      evaluateBuild(spec, {
        specHash: specHash(spec),
        state: "running",
        adapter: "cursor",
        at: "2026-01-01T00:00:00.000Z",
        waitingOnQuestions: true,
        message: "Waiting on owner questions.",
      }),
    ).toMatchObject({ state: "running", message: "Waiting on owner questions." });
  });
});
