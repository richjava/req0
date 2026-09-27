import { fixFromProofAllowed } from "./fix-from-proof.js";
import { NOUL_PASS } from "./gates.js";
import { improveAllowed, improveHint } from "./improve.js";
import { STACK_CHOICE_HINT } from "./stack.js";
import type { BuildMeter, Health, ReadyMeter, StageAction, StageBoard } from "./types.js";

export function buildAllowsProve(build: BuildMeter): boolean {
  if (build.owned === false) return true;
  if (build.state === "succeeded") return true;
  return build.ignored === true;
}

export function ignoreBuildAllowed(health: Health, ready: ReadyMeter = health.ready): boolean {
  if (health.build.owned === false) return false;
  if (ready.state !== "ready") return false;
  if (health.build.needsStack) return false;
  if (health.build.state === "running") return false;
  return health.build.state === "failed" && health.build.ignored !== true;
}

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
  const needsStack = health.build.needsStack === true;
  const buildAction: StageAction = implementOwned
    ? {
        id: "implement",
        label:
          health.build.state === "running" ? "Implementing" : neverSucceeded ? "Implement" : "Rebuild",
        enabled: readyOk && health.build.state !== "running" && !needsStack,
        hint: needsStack
          ? STACK_CHOICE_HINT
          : health.build.state === "running"
            ? "Cursor agent is running. Activity shows tools and messages as they happen."
            : health.build.state === "failed"
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
  const canProve = readyOk && buildAllowsProve(health.build) && health.proof.runtime;
  const proofAction: StageAction = {
    id: "prove",
    label: firstProve ? "Prove" : "Re-prove",
    enabled: canProve,
    hint: proofHint(health),
  };

  const canFix = fixFromProofAllowed(health, ready) && health.build.state !== "running";
  const fixFromProof: StageAction | undefined = canFix
    ? {
        id: "fix-from-proof",
        label: "Fix from proof",
        enabled: true,
        hint: "Starts a Cursor agent with the last proof-report.md and the implement brief. Does not edit requirement.md.",
      }
    : undefined;

  const ignoreBuild: StageAction | undefined = ignoreBuildAllowed(health, ready)
    ? {
        id: "ignore-build",
        label: "Ignore",
        enabled: true,
        hint: "Unlock Prove. You will be asked whether implementation succeeded.",
      }
    : undefined;

  const stopImplement: StageAction | undefined =
    implementOwned && health.build.state === "running"
      ? {
          id: "stop-implement",
          label: "Stop",
          enabled: true,
          hint: "Stops the Cursor agent. Build stays failed until you Rebuild or Ignore.",
        }
      : undefined;

  return {
    ready: readyAction,
    build: buildAction,
    proof: proofAction,
    ...(fixFromProof ? { fixFromProof } : {}),
    ...(ignoreBuild ? { ignoreBuild } : {}),
    ...(stopImplement ? { stopImplement } : {}),
  };
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
  const implementOwned = health.build.owned !== false;
  const waitingForBuild =
    implementOwned &&
    !health.build.ignored &&
    (health.build.state === "not_yet" ||
      health.build.state === "failed" ||
      health.build.state === "stale" ||
      health.build.state === "running");
  if (ready.state === "ready" && waitingForBuild) {
    if (health.build.state === "running" && stages.stopImplement?.enabled) {
      return stages.stopImplement;
    }
    return stages.build;
  }
  if (stages.fixFromProof?.enabled) return stages.fixFromProof;
  return stages.proof;
}

function proofHint(health: Health): string | undefined {
  const proof = health.proof;
  if (!proof.runtime) {
    return "Blocked without fixtures/runtime.yaml (baseUrl and deterministic login).";
  }
  if (!buildAllowsProve(health.build)) {
    return "Prove is locked until Build succeeded, or you Ignore a failed Build.";
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
