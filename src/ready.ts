import { createHash } from "node:crypto";
import { NOUL_FAIL, NOUL_PASS } from "./gates.js";
import { missingPersonaRoles, type PersonasResult } from "./personas.js";
import type {
  BuildMeter,
  BuildRun,
  CompileResult,
  Health,
  JevRun,
  ProofMeter,
  ReadyFinding,
  ReadyMeter,
  SpecAst,
} from "./types.js";

export function specHash(spec: SpecAst): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
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
  return { state: run.state, adapter: run.adapter, message: run.message };
}

export function emptyReady(reason: ReadyMeter["reason"] = "spec_invalid"): ReadyMeter {
  return {
    state: "not_yet",
    reason,
    blockers: 0,
    nits: 0,
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

  if (blockers > 0) {
    return {
      state: "blocked",
      reason: "blockers",
      blockers,
      nits,
      nextId: nextId ?? firstSpecId(findings),
      packNoul,
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
  };
}

export function applyReadyToHealth(health: Health, ready: ReadyMeter): Health {
  const { nextAction, howThisIsGoing } = scoreboard(health, ready);
  return { ...health, ready, nextAction, howThisIsGoing };
}

function scoreboard(health: Health, ready: ReadyMeter): Pick<Health, "nextAction" | "howThisIsGoing"> {
  const specState = health.spec.state;
  const errors = health.spec.findings.filter((finding) => finding.severity === "error");

  if (specState === "empty") {
    return {
      nextAction: { id: "create", label: "Create this requirement", enabled: true },
      howThisIsGoing: "Nothing here yet. Create the pack to begin.",
    };
  }

  if (specState !== "valid") {
    const first = errors[0];
    return {
      nextAction: {
        id: "fix-spec",
        label: first ? `Fix: ${truncate(first.message, 72)}` : "Finish the required sections",
        enabled: true,
      },
      howThisIsGoing:
        errors.length === 1
          ? `1 compile error. ${first?.message ?? "Keep filling the spec."}`
          : `${errors.length} compile errors. Spec is drafting, not valid.`,
    };
  }

  if (ready.state === "blocked") {
    const first = ready.findings.find((finding) => finding.severity === "blocker");
    const label = ready.nextId
      ? `Improve ${ready.nextId}`
      : first
        ? `Fix: ${truncate(first.message, 72)}`
        : "Fix Ready blockers";
    return {
      nextAction: {
        id: "fix-ready",
        label,
        enabled: true,
        hint: first?.message,
      },
      howThisIsGoing:
        ready.nits > 0
          ? `${ready.blockers} blocker${ready.blockers === 1 ? "" : "s"}, ${ready.nits} nit${ready.nits === 1 ? "" : "s"}. ${nextLine(ready)}`
          : `${ready.blockers} blocker${ready.blockers === 1 ? "" : "s"}. ${nextLine(ready)}`,
    };
  }

  if (ready.state === "ready") {
    if (health.build.state === "succeeded") {
      const runtime = health.proof.runtime;
      return {
        nextAction: {
          id: "prove",
          label: "Prove this requirement",
          enabled: runtime,
          hint: proofHint(health.proof),
        },
        howThisIsGoing: proofGoing(health),
      };
    }
    if (health.build.state === "stale") {
      return {
        nextAction: {
          id: "implement",
          label: "Re-implement this requirement",
          enabled: true,
          hint: health.build.message,
        },
        howThisIsGoing: "Spec changed after the last implement run. Build is stale.",
      };
    }
    return {
      nextAction: {
        id: "implement",
        label: "Implement this requirement",
        enabled: true,
        hint:
          health.build.state === "failed"
            ? health.build.message
            : "Starts a Cursor agent with derived/implement-brief.md. Use --adapter=manual to skip launch.",
      },
      howThisIsGoing:
        ready.nits > 0
          ? `Ready. Zero blockers, ${ready.nits} nit${ready.nits === 1 ? "" : "s"}. Implementation is next.`
          : "Ready. Zero blockers. Implementation is next.",
    };
  }

  if (ready.reason === "no_api_key") {
    return {
      nextAction: {
        id: "check-jev",
        label: "Check this spec with Jev",
        enabled: true,
        hint: "Needs TYPESAFE_API_KEY.",
      },
      howThisIsGoing:
        "The pack is valid. Ready stays Not yet until a TypeSafe API key is set. Persona checks do not need a key.",
    };
  }

  return {
    nextAction: {
      id: "check-jev",
      label: "Check this spec with Jev",
      enabled: true,
    },
    howThisIsGoing: "The pack is valid. Check it with Jev to turn on Ready.",
  };
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
  if (ready.nextId) return `Fix ${ready.nextId} next.`;
  const first = ready.findings.find((finding) => finding.severity === "blocker");
  return first?.message ?? "Fix the blockers.";
}

function fmt(noul: number): string {
  return noul.toFixed(2);
}

function proofHint(proof: ProofMeter): string {
  if (!proof.runtime) {
    return "Blocked without fixtures/runtime.yaml (baseUrl and deterministic login).";
  }
  if (proof.state === "passed") return "Proof passed. Click to re-run.";
  if (proof.state === "failed") return proof.message ?? "Proof failed. Click to re-run.";
  if (proof.state === "needs_review") {
    return "Proof needs review (noul between 0.15 and 0.75).";
  }
  if (proof.state === "stale") return "Spec changed after the last proof run. Re-prove.";
  return "Runs compiled derived/qa-plan.yaml in a browser. Progress and errors appear in Activity.";
}

function proofGoing(health: Health): string {
  if (!health.proof.runtime) return "Proof needs fixtures/runtime.yaml.";
  if (health.proof.state === "failed") {
    return health.proof.message ? `Proof failed: ${health.proof.message}` : "Proof failed.";
  }
  if (health.proof.state === "needs_review") return "Proof needs review.";
  if (health.proof.state === "stale") return "Proof is stale.";
  return "";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
