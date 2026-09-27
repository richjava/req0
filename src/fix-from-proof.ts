import type { Health, ProofMeter, ReadyMeter, SpecAst } from "./types.js";

export class FixFromProofLockedError extends Error {
  readonly code = "fix_from_proof_gate";

  constructor(
    message = "Fix from proof is only after Ready, a succeeded Build, and a Proof that failed or needs review.",
  ) {
    super(message);
    this.name = "FixFromProofLockedError";
  }
}

export function fixFromProofAllowed(health: Health, ready: ReadyMeter = health.ready): boolean {
  if (health.build.owned === false) return false;
  if (ready.state !== "ready") return false;
  if (health.build.state !== "succeeded") return false;
  if (health.build.needsStack) return false;
  return health.proof.state === "failed" || health.proof.state === "needs_review";
}

export function assertFixFromProofAllowed(health: Health, ready: ReadyMeter = health.ready): void {
  if (!fixFromProofAllowed(health, ready)) {
    throw new FixFromProofLockedError();
  }
}

export function emitFixFromProofBrief(input: {
  spec: SpecAst;
  proof: ProofMeter;
  reportPath: string;
  implementBriefPath: string;
}): string {
  const open = input.proof.findings.filter(
    (finding) => finding.severity === "fail" || finding.severity === "review",
  );
  const lines = [
    `# Fix from proof: ${input.spec.title}`,
    "",
    "Portable coding-agent brief. Close the failed and review cases from the last Prove. Do not invent rule, use-case, or role IDs.",
    "",
    "## Read these first",
    "",
    `- Last Prove: \`${input.reportPath}\` — same UC- IDs as requirement.md. Failed and Needs review first.`,
    `- Full implement brief: \`${input.implementBriefPath}\` — stack, business rules, matrix, personas, runtime.`,
    "",
    "## Rules",
    "",
    "- This repo already has a product app. Patch it. Do not scaffold a second application.",
    "- Do not edit `requirement.md`. That is spec Improve, not this action.",
    "- Implement only the named BR- and UC- IDs already in the spec and the proof report.",
    "- Boot or deterministic-login failures may be fixtures, `runtime.yaml`, or a dead sandbox — not a missing button. Check that before changing permissions.",
    "- An observation that is still the Sign in page is a login/reset problem, not an Approve/Assign product bug.",
    "- A mid-band Jev noul (between 0.15 and 0.75) is review, not a license to invent behavior.",
    "",
    "## Cases to close",
    "",
    `Proof is ${input.proof.state}. ${input.proof.message ?? ""}`.trim(),
    "",
  ];

  if (open.length === 0) {
    lines.push("No failed or review findings were listed. Read the proof report and close what it marks Failed or Needs review.", "");
  } else {
    for (const finding of open) {
      lines.push(`- ${finding.specId}: ${finding.message}`);
    }
    lines.push("");
  }

  lines.push(
    "## Done means",
    "",
    "The existing app matches the named cases in the proof report. Personas and `fixtures/runtime.yaml` still match that app. At most 3 `npx ampx sandbox --once` deploys. After the third, stop and report what is still failing. A coding-agent run finishing is **Build Succeeded**, not “the app boots.” Re-prove is next.",
    "",
  );

  return `${lines.join("\n")}\n`;
}
