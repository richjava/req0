import type { ProofCaseResult, ProofRun, QaPlan, ReadyMeter, SpecAst } from "./types.js";

const VERDICT_ORDER: Record<ProofCaseResult["verdict"], number> = {
  fail: 0,
  review: 1,
  pass: 2,
};

const SECTION_HEADING: Record<ProofCaseResult["verdict"], string> = {
  fail: "Failed",
  review: "Needs review",
  pass: "Passed",
};

export function emitProofReport(input: {
  spec: SpecAst;
  plan: QaPlan;
  run: ProofRun;
  ready?: Pick<ReadyMeter, "state" | "packNoul">;
  baseUrl?: string;
}): string {
  const { spec, plan, run } = input;
  const passed = run.cases.filter((item) => item.verdict === "pass").length;
  const failed = run.cases.filter((item) => item.verdict === "fail").length;
  const review = run.cases.filter((item) => item.verdict === "review").length;
  const result = !run.boot.ok
    ? "Failed — app did not boot"
    : failed
      ? `Failed — ${passed} passed, ${failed} failed${review ? `, ${review} needs review` : ""}`
      : review
        ? `Needs review — ${passed} passed, ${review} needs review`
        : `Passed — ${run.cases.length} case${run.cases.length === 1 ? "" : "s"}`;

  const lines = [
    `# Proof report — ${spec.requirementId}`,
    "",
    spec.title,
    "",
    `Checked at: ${run.checkedAt}`,
    `Result: **${result}**`,
  ];
  if (input.ready) {
    const noul =
      typeof input.ready.packNoul === "number" ? ` · ${input.ready.packNoul.toFixed(2)}` : "";
    lines.push(`Ready: ${input.ready.state}${noul}`);
  }
  if (input.baseUrl) lines.push(`Runtime: ${input.baseUrl}`);
  lines.push(`Boot: ${run.boot.ok ? "ok" : (run.boot.message ?? "failed")}`);
  lines.push("");
  lines.push(
    "This report is the last Prove. It uses the same use-case IDs as requirement.md. It is not a second test suite.",
  );
  lines.push("");

  if (!run.boot.ok && !run.cases.length) {
    lines.push("No cases were run.");
    lines.push("");
    return lines.join("\n");
  }

  const byId = new Map(plan.cases.map((item) => [item.id, item]));
  const titles = new Map(spec.useCases.map((item) => [item.id, item.title]));
  const ordered = [...run.cases].sort((a, b) => {
    const rank = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (rank !== 0) return rank;
    return plan.cases.findIndex((item) => item.id === a.id) - plan.cases.findIndex((item) => item.id === b.id);
  });

  let section: ProofCaseResult["verdict"] | undefined;
  for (const item of ordered) {
    if (item.verdict !== section) {
      section = item.verdict;
      lines.push(`## ${SECTION_HEADING[item.verdict]}`, "");
    }
    const qa = byId.get(item.id);
    const title = titles.get(item.id);
    lines.push(`### ${item.id}${title ? ` — ${title}` : ""}`, "");
    lines.push(`- Actor: ${qa?.actor ?? "—"}`);
    lines.push(`- Kind: ${item.kind}`);
    lines.push(`- Verdict: ${item.verdict}`);
    if (typeof item.noul === "number") lines.push(`- Confidence (noul): ${item.noul.toFixed(2)}`);
    if (qa?.preconditions) lines.push(`- Preconditions: ${qa.preconditions}`);
    if (qa?.steps.length) {
      lines.push("- Steps:");
      for (const [index, step] of qa.steps.entries()) {
        lines.push(`  ${index + 1}. ${step}`);
      }
    }
    if (qa?.outcome) lines.push(`- Expected: ${qa.outcome}`);
    lines.push(`- Observed: ${item.message}`);
    lines.push("");
  }

  return lines.join("\n");
}
