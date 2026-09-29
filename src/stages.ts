import { adapterDisplayName } from "./adapter.js";
import { fixFromProofAllowed } from "./fix-from-proof.js";
import { NOUL_PASS } from "./gates.js";
import { improveAllowed, improveHint } from "./improve.js";
import { STACK_CHOICE_HINT } from "./stack.js";
import { OPTIONAL_H2, REQUIRED_H2 } from "./types.js";
import type {
  BuildMeter,
  Health,
  PackListMeter,
  PipelineTone,
  PipelineView,
  ReadyMeter,
  StageAction,
  StageBoard,
} from "./types.js";

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
  const state = ready.state === "blocked" ? "Blocked" : ready.state === "ready" ? "Clear" : "Not yet";
  if (ready.jevCurrent && typeof ready.packNoul === "number") {
    return `${state} · ${ready.packNoul.toFixed(2)}`;
  }
  return state;
}

export const SECTION_PURPOSES: Record<string, string> = {
  "Business Rules": "What must be true. Each rule has Id, Statement, and Observable.",
  "Use Cases": "Who does what. Actor, preconditions, steps, and Outcome. Look for is deny; Choose is allow.",
  "Roles & Permissions": "The matrix: which role may perform which action.",
  Overview: "Optional context for the requirement.",
  "Out of scope": "Optional. What this pack does not cover.",
  "Open questions": "Optional. Unresolved questions for the owner.",
  Entities: "Optional. Named things the spec talks about.",
  "UI notes": "Optional. Presentation hints that are not rules.",
};

export function sectionCatalog(): { name: string; required: boolean; purpose: string }[] {
  return [
    ...REQUIRED_H2.map((name) => ({ name, required: true, purpose: SECTION_PURPOSES[name] ?? "" })),
    ...OPTIONAL_H2.map((name) => ({ name, required: false, purpose: SECTION_PURPOSES[name] ?? "" })),
  ];
}

export function pipelineView(health: Health | null, packPresent: boolean): PipelineView {
  const implementOwned = health?.build.owned !== false;
  const specState = health?.spec.state ?? "empty";
  const ready = health?.ready;
  const build = health?.build;
  const proof = health?.proof;

  const defineTone: PipelineTone =
    specState === "empty"
      ? "idle"
      : specState === "drafting"
        ? "draft"
        : ready?.state === "blocked"
          ? "bad"
          : ready?.state === "ready"
            ? "ok"
            : "draft";

  const implementTone: PipelineTone =
    build?.state === "running"
      ? "progress"
      : build?.state === "failed"
        ? "bad"
        : build?.state === "succeeded"
          ? "ok"
          : build?.state === "stale"
            ? "draft"
            : "idle";

  const qaTone: PipelineTone =
    proof?.state === "passed"
      ? "ok"
      : proof?.state === "failed"
        ? "bad"
        : proof?.state === "needs_review" || proof?.state === "stale"
          ? "draft"
          : "idle";

  const specTone: PipelineTone =
    specState === "empty" ? "idle" : specState === "drafting" ? "draft" : specState === "valid" ? "ok" : "draft";
  const judgmentTone: PipelineTone =
    ready?.state === "blocked" ? "bad" : ready?.state === "ready" ? "ok" : specState === "valid" ? "draft" : "idle";
  const specBadge =
    specState === "empty" ? "Empty" : specState === "drafting" ? "Drafting" : specState === "valid" ? "Valid" : specState;
  const defineBadge = specState !== "valid" ? specBadge : ready ? readyBadge(ready) : "Not yet";
  const judgmentBadge = ready ? readyBadge(ready) : "Not yet";
  const implementBadge =
    build?.state === "running"
      ? "Implementing"
      : build?.state === "succeeded"
        ? "Succeeded"
        : build?.state === "failed"
          ? "Failed"
          : build?.state === "stale"
            ? "Stale"
            : "Not yet";
  const qaBadge =
    proof?.state === "passed"
      ? "Passed"
      : proof?.state === "failed"
        ? "Failed"
        : proof?.state === "needs_review"
          ? "Needs review"
          : proof?.state === "stale"
            ? "Stale"
            : "Not yet";

  return {
    implementOwned,
    nodes: [
      {
        id: "start",
        label: "Start",
        view: "define",
        tone: packPresent ? "ok" : "idle",
        badge: packPresent ? "Pack" : "Create",
      },
      {
        id: "define",
        label: "Define",
        view: "define",
        tone: defineTone,
        badge: defineBadge,
        mark: defineTone === "bad" ? "block" : undefined,
        children: [
          { id: "spec", label: "Spec", view: "spec", tone: specTone, badge: specBadge },
          {
            id: "judgment",
            label: "Judgment",
            view: "judgment",
            tone: judgmentTone,
            badge: judgmentBadge,
            mark: judgmentTone === "bad" ? "block" : undefined,
          },
        ],
      },
      {
        id: "implement",
        label: "Implement",
        view: "implement",
        tone: implementTone,
        badge: implementBadge,
        mark: implementTone === "bad" ? "fail" : undefined,
        hidden: !implementOwned,
      },
      {
        id: "qa",
        label: "QA",
        view: "qa",
        tone: qaTone,
        badge: qaBadge,
        mark: qaTone === "bad" ? "fail" : undefined,
      },
      {
        id: "end",
        label: "End",
        view: "qa",
        tone: proof?.state === "passed" ? "ok" : "idle",
        badge: proof?.state === "passed" ? "Passed" : undefined,
      },
    ],
  };
}

export function packListMeters(health: Health | null, packPresent: boolean): PackListMeter[] {
  const view = pipelineView(health, packPresent);
  const define = view.nodes.find((node) => node.id === "define");
  const spec = define?.children?.find((child) => child.id === "spec");
  const judgment = define?.children?.find((child) => child.id === "judgment");
  const implement = view.nodes.find((node) => node.id === "implement");
  const qa = view.nodes.find((node) => node.id === "qa");
  const meters: PackListMeter[] = [];
  if (spec) meters.push({ key: "spec", label: spec.label, tone: spec.tone, badge: spec.badge ?? "" });
  if (judgment) {
    meters.push({ key: "ready", label: judgment.label, tone: judgment.tone, badge: judgment.badge ?? "" });
  }
  if (implement && !implement.hidden) {
    meters.push({
      key: "build",
      label: implement.label,
      tone: implement.tone,
      badge: implement.badge ?? "",
    });
  }
  if (qa) meters.push({ key: "proof", label: qa.label, tone: qa.tone, badge: qa.badge ?? "" });
  return meters;
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
  const agent = adapterDisplayName(health.build.adapter === "copilot" ? "copilot" : "cursor");
  const buildAction: StageAction = implementOwned
    ? {
        id: "implement",
        label:
          health.build.state === "running" ? "Implementing" : neverSucceeded ? "Implement" : "Reimplement",
        enabled: readyOk && health.build.state !== "running" && !needsStack,
        hint: needsStack
          ? STACK_CHOICE_HINT
          : health.build.state === "running"
            ? `${agent} agent is running. Activity shows tools and messages as they happen.`
            : health.build.state === "failed"
            ? health.build.message
            : neverSucceeded
              ? `Starts a ${agent} agent with derived/implement-brief.md.`
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
        hint: `Starts a ${agent} agent with the last proof-report.md and the implement brief. Does not edit requirement.md.`,
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
          hint: `Stops the ${agent} agent. Build stays failed until you Reimplement or Ignore.`,
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
