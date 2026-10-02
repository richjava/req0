import { adapterDisplayName } from "./adapter.js";
import { createHash } from "node:crypto";
import { NOUL_FAIL, NOUL_PASS } from "./gates.js";
import { improveAllowed } from "./improve.js";
import { missingPersonaRoles, type PersonasResult } from "./personas.js";
import { computeStages, primaryAction } from "./stages.js";
import type {
  BuildMeter,
  BuildRun,
  CompileResult,
  Health,
  JevRun,
  ReadyFinding,
  ReadyMeter,
  SpecAst,
} from "./types.js";

export function specHash(spec: SpecAst): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

/** Pids of implement agents this process launched and is still waiting on. */
export const followedImplementPids = new Set<number>();

export const IMPLEMENT_INTERRUPTED =
  "Implement was interrupted. This Req0 process is not following an implement agent. Reimplement or Fix from proof.";

export function followImplementPid(pid?: number): void {
  if (typeof pid === "number" && pid > 0) followedImplementPids.add(pid);
}

export function unfollowImplementPid(pid?: number): void {
  if (typeof pid === "number") followedImplementPids.delete(pid);
}

export function evaluateBuild(spec: SpecAst | null, run: BuildRun | null): BuildMeter {
  if (!run) return { state: "not_yet" };
  if (spec && run.specHash !== specHash(spec) && run.state !== "failed") {
    return {
      state: "stale",
      adapter: run.adapter,
      message: "Spec changed after the last implement run.",
    };
  }
  if (run.state === "running" && !isFollowedImplement(run.pid)) {
    if (run.waitingOnQuestions) {
      return {
        state: "running",
        adapter: run.adapter,
        message: run.message,
      };
    }
    return {
      state: "failed",
      adapter: run.adapter,
      message: IMPLEMENT_INTERRUPTED,
    };
  }
  return {
    state: run.state,
    adapter: run.adapter,
    message: run.message,
    ...(run.ignored ? { ignored: true } : {}),
  };
}

export class IgnoreBuildLockedError extends Error {
  readonly code = "ignore_build_gate";

  constructor(message = "Ignore is only when Build failed.") {
    super(message);
    this.name = "IgnoreBuildLockedError";
  }
}

export function isFollowedImplement(pid?: number): boolean {
  return typeof pid === "number" && pid > 0 && followedImplementPids.has(pid);
}

export function implementProcessGone(pid?: number): boolean {
  if (typeof pid !== "number" || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

export function emptyReady(reason: ReadyMeter["reason"] = "spec_invalid"): ReadyMeter {
  return {
    state: "not_yet",
    reason,
    blockers: 0,
    nits: 0,
    jevCurrent: false,
    findings: [],
  };
}

export function attachReady(
  result: CompileResult,
  input: {
    personas: PersonasResult;
    jevRun?: JevRun | null;
    hasApiKey: boolean;
  },
): CompileResult {
  const ready = evaluateReady({
    spec: result.spec,
    specState: result.health.spec.state,
    personas: input.personas,
    jevRun: input.jevRun,
    hasApiKey: input.hasApiKey,
  });
  return {
    ...result,
    health: applyReadyToHealth(result.health, ready),
  };
}

export function evaluateReady(input: {
  spec: SpecAst | null;
  specState: Health["spec"]["state"];
  personas: PersonasResult;
  jevRun?: JevRun | null;
  hasApiKey: boolean;
}): ReadyMeter {
  if (input.specState !== "valid" || !input.spec) {
    return emptyReady("spec_invalid");
  }

  const findings: ReadyFinding[] = [];

  if (input.personas.missingFile) {
    findings.push({
      id: "persona.file",
      kind: "persona_missing",
      severity: "blocker",
      message: "fixtures/personas.yaml is missing. Ready needs a test persona per matrix role.",
    });
  }

  for (const finding of input.personas.findings) {
    findings.push({
      id: `persona.parse.${finding.line}`,
      kind: "persona_missing",
      severity: "blocker",
      message: finding.message,
      line: finding.line,
    });
  }

  for (const role of missingPersonaRoles(input.spec, input.personas)) {
    findings.push({
      id: `persona.missing.${role}`,
      kind: "persona_missing",
      severity: "blocker",
      message: `Role "${role}" has no persona in fixtures/personas.yaml.`,
      specId: role,
    });
  }

  let packNoul: number | undefined;
  let nextId: string | undefined;
  const run =
    input.jevRun && input.jevRun.specHash === specHash(input.spec) ? input.jevRun : null;

  if (run) {
    const byId = new Map(run.answers.map((answer) => [answer.id, answer]));
    for (const rule of input.spec.businessRules) {
      const answer = byId.get(`rule.observable.${rule.id}`);
      if (!answer || typeof answer.noul !== "number") continue;
      classifyNoul(findings, {
        id: `ready.untestable.${rule.id}`,
        kind: "untestable_rule",
        specId: rule.id,
        line: rule.line,
        noul: answer.noul,
        yesMeansPass: true,
        blockerMessage: `${rule.id} is not testable. Observable does not make Statement noticeable (noul ${fmt(answer.noul)}).`,
        nitMessage: `${rule.id} observability is uncertain (noul ${fmt(answer.noul)}).`,
      });
    }

    for (const useCase of input.spec.useCases) {
      const answer = byId.get(`usecase.contradicts.${useCase.id}`);
      if (!answer || typeof answer.noul !== "number") continue;
      classifyNoul(findings, {
        id: `ready.contradict.${useCase.id}`,
        kind: "matrix_contradiction",
        specId: useCase.id,
        line: useCase.line,
        noul: answer.noul,
        yesMeansPass: false,
        blockerMessage: `${useCase.id} contradicts the matrix for ${useCase.actor} (noul ${fmt(answer.noul)}).`,
        nitMessage: `${useCase.id} may contradict the matrix (noul ${fmt(answer.noul)}).`,
      });
    }

    for (const [id, section] of [
      ["section.score.business-rules", "Business Rules"],
      ["section.score.use-cases", "Use Cases"],
      ["section.score.roles-permissions", "Roles & Permissions"],
    ] as const) {
      const answer = byId.get(id);
      if (!answer || typeof answer.score !== "number") continue;
      if (answer.score >= 2) continue;
      findings.push({
        id: `ready.section.${id}`,
        kind: "section_score",
        severity: "nit",
        message:
          answer.score < 1
            ? `${section} is empty for a coding agent.`
            : `${section} is only partial for a coding agent.`,
        specId: section,
      });
    }

    const choice = byId.get("pack.next-id");
    if (choice?.choice) nextId = choice.choice;

    const pack = byId.get("pack.agent-ready");
    if (typeof pack?.noul === "number") {
      packNoul = pack.noul;
      if (pack.noul < NOUL_PASS) {
        findings.push({
          id: "ready.pack-gate",
          kind: "pack_gate",
          severity: "blocker",
          message: `Pack noul ${fmt(pack.noul)} is below the ${NOUL_PASS} gate. Not safe to hand to a coding agent.`,
          noul: pack.noul,
        });
      }
    }
  }

  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const nits = findings.filter((finding) => finding.severity === "nit").length;
  findings.sort((a, b) => Number(b.severity === "blocker") - Number(a.severity === "blocker"));

  const jevCurrent = Boolean(run);

  if (blockers > 0) {
    return {
      state: "blocked",
      reason: "blockers",
      blockers,
      nits,
      nextId: nextId ?? firstSpecId(findings),
      packNoul,
      jevCurrent,
      findings,
    };
  }

  if (run) {
    return {
      state: "ready",
      reason: "passed",
      blockers: 0,
      nits,
      nextId,
      packNoul,
      jevCurrent: true,
      findings,
    };
  }

  return {
    state: "not_yet",
    reason: input.hasApiKey ? "unchecked" : "no_api_key",
    blockers: 0,
    nits: 0,
    findings,
    packNoul,
    jevCurrent: false,
  };
}

export function applyReadyToHealth(health: Health, ready: ReadyMeter): Health {
  const stages = computeStages(health, ready);
  const nextAction = primaryAction(health, ready, stages);
  return { ...health, ready, stages, nextAction, howThisIsGoing: goingCopy(health, ready) };
}

function goingCopy(health: Health, ready: ReadyMeter): string {
  const specState = health.spec.state;
  const errors = health.spec.findings.filter((finding) => finding.severity === "error");

  if (specState === "empty") return "Nothing here yet. Create the pack to begin.";
  if (specState !== "valid") {
    const first = errors[0];
    return errors.length === 1
      ? `1 compile error. ${first?.message ?? "Keep filling the spec."}`
      : `${errors.length} compile errors. Spec is drafting, not valid.`;
  }

  if (ready.state === "blocked") {
    return ready.nits > 0
      ? `${ready.blockers} blocker${ready.blockers === 1 ? "" : "s"}, ${ready.nits} nit${ready.nits === 1 ? "" : "s"}. ${nextLine(ready)}`
      : `${ready.blockers} blocker${ready.blockers === 1 ? "" : "s"}. ${nextLine(ready)}`;
  }

  if (ready.state === "ready") {
    if (health.build.owned === false || health.build.state === "succeeded" || health.build.ignored) {
      return proofGoing(health);
    }
    if (health.build.state === "running") {
      const agent = adapterDisplayName(health.build.adapter ?? "cursor");
      return `${agent} agent is running. Activity shows tools and messages as they happen. Stop ends the run. Build Succeeded is not proof the app boots.`;
    }
    if (health.build.state === "stale") return "Spec changed after the last implement run. Build is stale.";
    return ready.nits > 0
      ? `Ready. Zero blockers, ${ready.nits} nit${ready.nits === 1 ? "" : "s"}. Implementation is next.`
      : "Ready. Zero blockers. Implementation is next.";
  }

  if (ready.reason === "no_api_key") {
    return "The pack is valid. Ready stays Not yet until a TypeSafe API key is set. Persona checks do not need a key.";
  }
  return "The pack is valid. Check it with Jev to turn on Ready.";
}

function classifyNoul(
  findings: ReadyFinding[],
  input: {
    id: string;
    kind: ReadyFinding["kind"];
    specId: string;
    line: number;
    noul: number;
    yesMeansPass: boolean;
    blockerMessage: string;
    nitMessage: string;
  },
): void {
  const pass = input.yesMeansPass ? input.noul >= NOUL_PASS : input.noul <= NOUL_FAIL;
  const fail = input.yesMeansPass ? input.noul <= NOUL_FAIL : input.noul >= NOUL_PASS;
  if (pass) return;
  findings.push({
    id: input.id,
    kind: fail ? input.kind : "uncertain",
    severity: fail ? "blocker" : "nit",
    message: fail ? input.blockerMessage : input.nitMessage,
    specId: input.specId,
    line: input.line,
    noul: input.noul,
  });
}

function firstSpecId(findings: ReadyFinding[]): string | undefined {
  return findings.find((finding) => finding.specId)?.specId;
}

function nextLine(ready: ReadyMeter): string {
  if (improveAllowed(ready)) {
    return typeof ready.packNoul === "number" && ready.packNoul < NOUL_PASS
      ? `Improve it can raise pack noul above ${NOUL_PASS.toFixed(2)}.`
      : "Improve it writes one opinionated pass.";
  }
  if (ready.nextId) return `Fix ${ready.nextId} next.`;
  const first = ready.findings.find((finding) => finding.severity === "blocker");
  return first?.message ?? "Fix the blockers.";
}

function fmt(noul: number): string {
  return noul.toFixed(2);
}

function proofGoing(health: Health): string {
  if (!health.proof.runtime) return "Proof needs fixtures/runtime.yaml.";
  if (health.proof.state === "failed") {
    const detail = health.proof.message ? `Proof failed: ${health.proof.message}` : "Proof failed.";
    return health.build.owned === false ? detail : `${detail} Fix from proof updates the app from the last report.`;
  }
  if (health.proof.state === "needs_review") {
    return health.build.owned === false
      ? "Proof needs review."
      : "Proof needs review. Fix from proof updates the app from the last report.";
  }
  if (health.proof.state === "stale") return "Proof is stale.";
  return "";
}

