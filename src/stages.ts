import { NOUL_PASS } from "./gates.js";
import { improveAllowed, improveHint } from "./improve.js";
import type { Health, ReadyMeter, StageAction, StageBoard } from "./types.js";

export function emptyStages(): StageBoard {
  return {
    ready: { id: "check-jev", label: "Check", enabled: false },
    build: { id: "implement", label: "Implement", enabled: false },
    proof: { id: "prove", label: "Prove", enabled: false },
  };
}

export function readyBadge(ready: ReadyMeter): string {
  const state = ready.state === "blocked" ? "Blocked" : ready.state === "ready" ? "Ready" : "Not yet";
  if (ready.jevCurrent && typeof ready.packNoul === "number") {
    return `${state} · ${ready.packNoul.toFixed(2)}`;
  }
  return state;
}

export function computeStages(health: Health, ready: ReadyMeter): StageBoard {
  const specValid = health.spec.state === "valid";
  const jevCurrent = ready.jevCurrent === true;

  let readyAction: StageAction;
  if (!specValid) {
    readyAction = { id: "check-jev", label: "Check", enabled: false };
  } else if (improveAllowed(ready)) {
    readyAction = {
      id: "improve",
      label: "Improve it",
      enabled: true,
      hint: improveHint(ready),
    };
  } else if (!jevCurrent) {
    readyAction = {
      id: "check-jev",
      label: "Check",
      enabled: true,
      hint: ready.reason === "no_api_key" ? "Needs TYPESAFE_API_KEY." : "Re-check after editing the spec.",
    };
  } else if (ready.state === "blocked" || (typeof ready.packNoul === "number" && ready.packNoul < NOUL_PASS)) {
    readyAction = {
      id: "check-jev",
      label: "Check",
      enabled: true,
      hint: "Check with Jev before improving the same findings again.",
    };
  } else {
    readyAction = { id: "improve", label: "Improve it", enabled: false };
  }

  const readyOk = ready.state === "ready";
  const implementOwned = health.build.owned !== false;
  const neverSucceeded = health.build.state === "not_yet" || health.build.state === "failed";
  const buildAction: StageAction = implementOwned
    ? {
        id: "implement",
        label: neverSucceeded ? "Implement" : "Rebuild",
        enabled: readyOk && health.build.state !== "running",
        hint:
          health.build.state === "failed"
            ? health.build.message
            : neverSucceeded
              ? "Starts a Cursor agent with derived/implement-brief.md. Use --adapter=manual to skip launch."
              : health.build.message,
      }
    : {
        id: "implement",
        label: "Implement",
        enabled: false,
        hidden: true,
        hint: "Implement is off in req0.json. Build this repo another way, then Prove.",
      };

  const firstProve = health.proof.state === "not_yet";
  const buildReady = implementOwned ? health.build.state === "succeeded" : true;
  const canProve = readyOk && buildReady && health.proof.runtime;
  const proofAction: StageAction = {
    id: "prove",
    label: firstProve ? "Prove" : "Re-prove",
    enabled: canProve,
    hint: proofHint(health),
  };

  return { ready: readyAction, build: buildAction, proof: proofAction };
}

export function primaryAction(health: Health, ready: ReadyMeter, stages: StageBoard): Health["nextAction"] {
  if (health.spec.state === "empty") {
    return { id: "create", label: "Create this requirement", enabled: true };
  }
  if (health.spec.state !== "valid") {
    const first = health.spec.findings.find((finding) => finding.severity === "error");
    return {
      id: "fix-spec",
      label: first ? `Fix: ${truncate(first.message, 72)}` : "Finish the required sections",
      enabled: true,
    };
  }
  if (stages.ready.enabled) return stages.ready;
  if (stages.build.enabled && (health.build.state === "not_yet" || health.build.state === "failed" || health.build.state === "stale")) {
    return stages.build;
  }
  return stages.proof;
}

function proofHint(health: Health): string | undefined {
  const proof = health.proof;
  if (!proof.runtime) {
    return "Blocked without fixtures/runtime.yaml (baseUrl and deterministic login).";
  }
  if (proof.state === "passed") return "Proof passed. Click to re-run.";
  if (proof.state === "failed") return proof.message ?? "Proof failed. Click to re-run.";
  if (proof.state === "needs_review") return "Proof needs review (noul between 0.15 and 0.75).";
  if (proof.state === "stale") {
    return proof.message ?? "Spec or build changed after the last proof run. Re-prove.";
  }
  return "Runs compiled derived/qa-plan.yaml in a browser. Progress and errors appear in Activity.";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
