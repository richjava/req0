import { NOUL_PASS } from "./gates.js";
import { questionsBriefSection } from "./agent-questions.js";
import type { ReadyFinding, ReadyMeter, SpecAst } from "./types.js";

export class ImproveLockedError extends Error {
  readonly code = "improve_gate";

  constructor(message = "Improve it is only when Ready is blocked or pack noul is below 0.75.") {
    super(message);
    this.name = "ImproveLockedError";
  }
}

export function findingKeys(finding: ReadyFinding): string[] {
  return [finding.id, finding.specId].filter((key): key is string => Boolean(key));
}

export function improveFindings(ready: ReadyMeter): ReadyFinding[] {
  const skip = new Set(ready.alreadyImproved ?? []);
  return ready.findings.filter(
    (finding) => !skip.has(finding.id) && !(finding.specId && skip.has(finding.specId)),
  );
}

export function improveAllowed(ready: ReadyMeter): boolean {
  const open = improveFindings(ready);
  if (open.length === 0) return false;
  if (open.some((finding) => finding.kind === "persona_missing")) return true;
  if (ready.jevCurrent !== true) return false;
  if (ready.state === "blocked") return true;
  return typeof ready.packNoul === "number" && ready.packNoul < NOUL_PASS;
}

export function improveHint(ready: ReadyMeter): string {
  if (typeof ready.packNoul === "number" && ready.packNoul < NOUL_PASS) {
    return `Opinionated pass to raise pack noul above ${NOUL_PASS.toFixed(2)}.`;
  }
  const first = improveFindings(ready)[0];
  return first?.message ?? "Opinionated pass for Ready blockers.";
}

export function assertImproveAllowed(ready: ReadyMeter): void {
  if (!improveAllowed(ready)) {
    throw new ImproveLockedError();
  }
}

export function emitImproveBrief(input: {
  spec: SpecAst | null;
  ready: ReadyMeter;
  findings?: ReadyFinding[];
}): string {
  const findings = input.findings ?? improveFindings(input.ready);
  const personas = findings.some((finding) => finding.kind === "persona_missing");
  const noul =
    typeof input.ready.packNoul === "number" ? input.ready.packNoul.toFixed(2) : "unknown";
  const specIds = input.spec
    ? [
        ...input.spec.businessRules.map((rule) => rule.id),
        ...input.spec.useCases.map((useCase) => useCase.id),
        ...input.spec.matrix.roles,
      ]
    : [];

  const lines = [
    `# Improve: ${input.spec?.requirementId ?? "requirement"}`,
    "",
    "Opinionated writer pass. Patch the pack so a coding agent can implement without guessing.",
    "If a required decision is missing, write derived/agent-questions.json and stop. Do not guess. Do not patch requirement.md in that same turn.",
    "",
    "## Goal",
    "",
    `- Pack noul is ${noul}. The gate is ${NOUL_PASS.toFixed(2)}.`,
    `- Ready is ${input.ready.state} (${input.ready.blockers} blocker${input.ready.blockers === 1 ? "" : "s"}, ${input.ready.nits} nit${input.ready.nits === 1 ? "" : "s"}).`,
    "- Raise pack noul above the gate and clear Ready blockers.",
    "",
    "## Findings",
    "",
  ];

  if (findings.length === 0) {
    lines.push("No open Ready findings.", "");
  }

  for (const [index, finding] of findings.entries()) {
    lines.push(`### ${index + 1}. ${finding.specId ?? finding.id}`, "");
    lines.push(`- Kind: ${finding.kind}`);
    lines.push(`- Severity: ${finding.severity}`);
    if (finding.specId) lines.push(`- Spec id: ${finding.specId}`);
    if (typeof finding.noul === "number") lines.push(`- Noul: ${finding.noul.toFixed(2)}`);
    lines.push(`- Message: ${finding.message}`, "");
    lines.push(...excerptForFinding(finding, input.spec));
  }

  lines.push("## Existing spec IDs", "", "Do not invent new BR- or UC- IDs. Use only these:", "");
  if (specIds.length === 0) {
    lines.push("- (none compiled)", "");
  } else {
    for (const id of specIds) lines.push(`- ${id}`);
    lines.push("");
  }

  lines.push(
    "## Opinionated rules",
    "",
    "- Rewrite every Outcome to what a person sees after the steps: a status or label, and whether a named control is present, absent, or disabled.",
    "- Tighten every rule Observable so a person or test can notice it.",
    "- `Choose …` is an allow path. `Look for …` is a deny path. Do not invert a use case to match a matrix cell.",
    "- A matrix allow cell plus a business rule that hides or disables the control is consistent. Keep those Look-for use cases.",
    "- Do not write matrix talk in Outcome or Entities: no `is allow`, `is deny`, no restating action cells, no `without changing the matrix cell`.",
    "- Name the exact Choose / Look for / Select controls. State tester preconditions.",
    personas
      ? "- Missing persona: prefer asking whether the owner has a real test user. If they do not, add `email: <role-slug>@example.test` and `password: test-only-not-production` in fixtures/personas.yaml."
      : "- Do not add personas unless a finding is persona_missing.",
    "- You may edit every section the findings name. This is one pack pass.",
    "",
    questionsBriefSection().trimEnd(),
    "",
    "## Fence",
    "",
    "- Patch `requirement.md` only, then stop.",
    personas
      ? "- At least one finding is a missing persona: you may also edit `fixtures/personas.yaml`."
      : "- Do not add files except the patch to `requirement.md`.",
    "- Do not invent spec IDs.",
    "- Do not implement the product app.",
    "- Stop after the patch so the owner can review the diff, then Check with Jev. Do not Check yourself.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

export function excerptForFinding(finding: ReadyFinding, spec: SpecAst | null | undefined): string[] {
  if (!spec) return [];
  const useCase = spec.useCases.find((item) => item.id === finding.specId);
  if (useCase) {
    const cells = spec.matrix.actions
      .map((action) => `${action.id}: ${action.permissions[useCase.actor] ?? "—"}`)
      .join("; ");
    return [
      "Current spec:",
      "",
      `- Actor: ${useCase.actor}`,
      `- Preconditions: ${useCase.preconditions}`,
      "- Steps:",
      ...useCase.steps.map((step, index) => `  ${index + 1}. ${step}`),
      `- Outcome: ${useCase.outcome}`,
      `- Matrix for ${useCase.actor}: ${cells || "—"}`,
      "",
    ];
  }
  const rule = spec.businessRules.find((item) => item.id === finding.specId);
  if (rule) {
    return [
      "Current spec:",
      "",
      `- Statement: ${rule.statement}`,
      `- Observable: ${rule.observable}`,
      "",
    ];
  }
  return [];
}
