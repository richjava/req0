import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { questionsBriefSection, type AgentQuestionsRound } from "./agent-questions.js";
import { standardsBriefSection, type LoadedStandards } from "./standards.js";
import { systemMapBriefSection, type LoadedSystemMap } from "./system-map.js";
import type { SpecAst } from "./types.js";

export const IMPLEMENT_PLAN_FILE = "implement-plan.md";
export const IMPLEMENT_PLAN_STATE_FILE = "implement-plan.json";
export const IMPLEMENT_PLAN_BRIEF_FILE = "implement-plan-brief.md";
export const IMPLEMENT_PLANS_DIR = "plans";

export type ImplementPlanStatus = "running" | "waiting_questions" | "accepted" | "failed";

export type ImplementPlanState = {
  version: 1;
  specHash: string;
  status: ImplementPlanStatus;
  at: string;
  snapshot?: string;
};

export type ImplementPlanPaths = {
  derived: string;
  implementPlan: string;
  implementPlanState: string;
  implementPlanBrief: string;
  implementPlans: string;
};

export function parseImplementPlanState(raw: unknown): ImplementPlanState | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (body.version !== 1) return null;
  if (typeof body.specHash !== "string") return null;
  if (
    body.status !== "running" &&
    body.status !== "waiting_questions" &&
    body.status !== "accepted" &&
    body.status !== "failed"
  ) {
    return null;
  }
  if (typeof body.at !== "string" || !body.at.trim()) return null;
  const snapshot = typeof body.snapshot === "string" && body.snapshot.trim() ? body.snapshot : undefined;
  return {
    version: 1,
    specHash: body.specHash,
    status: body.status,
    at: body.at,
    ...(snapshot ? { snapshot } : {}),
  };
}

export async function readImplementPlanState(paths: ImplementPlanPaths): Promise<ImplementPlanState | null> {
  try {
    return parseImplementPlanState(JSON.parse(await readFile(paths.implementPlanState, "utf8")));
  } catch {
    return null;
  }
}

export async function writeImplementPlanState(paths: ImplementPlanPaths, state: ImplementPlanState): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.implementPlanState, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function readImplementPlanMarkdown(paths: ImplementPlanPaths): Promise<string> {
  try {
    return await readFile(paths.implementPlan, "utf8");
  } catch {
    return "";
  }
}

export function planIsStale(state: ImplementPlanState | null, specHash: string): boolean {
  if (!state) return true;
  if (state.status === "failed") return true;
  return state.specHash !== specHash;
}

export function snapshotPlanFilename(at: Date): string {
  return `${at.toISOString().replaceAll(":", "")}.md`;
}

export async function snapshotAcceptedPlan(paths: ImplementPlanPaths, at = new Date()): Promise<string> {
  const markdown = await readImplementPlanMarkdown(paths);
  await mkdir(paths.implementPlans, { recursive: true });
  let name = snapshotPlanFilename(at);
  let dest = path.join(paths.implementPlans, name);
  let n = 2;
  while (await fileExists(dest)) {
    name = snapshotPlanFilename(at).replace(/\.md$/, `-${n}.md`);
    dest = path.join(paths.implementPlans, name);
    n += 1;
  }
  await writeFile(dest, markdown, "utf8");
  return `derived/${IMPLEMENT_PLANS_DIR}/${name}`;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function formatPlanDecisionsRound(round: AgentQuestionsRound): string {
  const lines = [`### Round ${round.at}`, ""];
  for (const question of round.questions) {
    lines.push(`- \`${question.id}\`: ${question.prompt}`);
    if (question.kind === "choice" && question.options?.length) {
      const labels = question.options.map((option, index) =>
        index === 0 ? `${option.label} (recommended)` : option.label,
      );
      lines.push(`  - Options: ${labels.join("; ")}`);
    }
    if (question.answer?.skipped) {
      lines.push("  - Answer: skipped. The agent must decide and record that decision.");
    } else if (question.answer?.optionId) {
      const option = question.options?.find((item) => item.id === question.answer?.optionId);
      lines.push(`  - Answer: ${option?.label ?? question.answer.optionId}`);
    } else if (question.answer?.text?.trim()) {
      lines.push(`  - Answer: ${question.answer.text.trim()}`);
    } else if (question.answer?.artifact) {
      lines.push(`  - Answer: uploaded context/${question.answer.artifact}`);
    } else {
      lines.push("  - Answer: (none)");
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function appendDecisionsSection(markdown: string, block: string): string {
  const trimmed = markdown.trimEnd();
  const heading = "## Decisions";
  const idx = trimmed.search(/^## Decisions\s*$/m);
  if (idx < 0) {
    return `${trimmed}\n\n${heading}\n\n${block.trimEnd()}\n`;
  }
  const after = trimmed.slice(idx + heading.length).replace(/^\s*/, "");
  const next = after.search(/^## /m);
  const beforeHeading = trimmed.slice(0, idx).trimEnd();
  const existing = (next < 0 ? after : after.slice(0, next)).trimEnd();
  const rest = next < 0 ? "" : `\n\n${after.slice(next).trimStart()}`;
  const body = existing ? `${existing}\n\n${block.trimEnd()}` : block.trimEnd();
  return `${beforeHeading}\n\n${heading}\n\n${body}${rest}\n`;
}

export async function appendPlanDecisions(paths: ImplementPlanPaths, round: AgentQuestionsRound): Promise<void> {
  const current = await readImplementPlanMarkdown(paths);
  const next = appendDecisionsSection(current || "# Implement plan\n", formatPlanDecisionsRound(round));
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.implementPlan, next, "utf8");
}

export const MANUAL_STUB_PLAN = `# Implement plan

## Intent

Manual adapter: the owner implements from the coding brief.

## Schema delta

None unless the owner changes the system map.

## Implications

None recorded.

## Decisions

None. Manual adapter does not interview.

## Traceability

See the named BR- and UC- IDs in \`derived/implement-brief.md\`.

## Approach

Follow the implement brief. Update \`docs/system.md\` after the change lands.
`;

export function emitImplementPlanBrief(input: {
  spec: SpecAst;
  system: LoadedSystemMap;
  standards?: LoadedStandards | null;
  fromProof?: boolean;
}): string {
  const { spec, system } = input;
  const lines = [
    `# Implement plan: ${spec.title}`,
    "",
    "Write a plan for this Implement pass. Do not write product code. Do not edit `requirement.md`.",
    "`requirement.md` is the spec. The system map is as-built. The plan is the proposed delta for this pass.",
    "",
    ...systemMapBriefSection(system),
    ...standardsBriefSection(input.standards),
    "## Pack",
    "",
    "- Read `derived/implement-brief.md` and `derived/spec.json`.",
    "- Read `requirement.md`.",
    input.fromProof
      ? "- This pass is Fix from proof. Also read `derived/proof-report.md`. Schema delta may be none."
      : "- Propose how this pack lands in the current system.",
    "",
    "## Write `derived/implement-plan.md`",
    "",
    "Use these headings:",
    "",
    "- Intent",
    "- Schema delta (none / add / change). Optional mermaid is illustration only.",
    "- Implications",
    "- Decisions (do not delete the host Q&A log under this heading)",
    "- Traceability (which BR- and UC- IDs this pass covers)",
    "- Approach",
    "",
    "If adding or changing entities or relationships has implications the owner should decide, write `derived/agent-questions.json` with `channel: \"plan\"` and **stop**. At most four questions. Recommended choice first. Set `allowCustom` when they may type something else.",
    "The owner may skip. Skipped is not an answer: decide and record that decision under Decisions. Do not invent BR- or UC- IDs.",
    "If no decision is required, write the plan and stop with no questions file.",
    "",
    questionsBriefSection({ channel: "plan" }).trimEnd(),
    "",
    "## Fence",
    "",
    "- Patch `derived/implement-plan.md` (and questions if needed), then stop.",
    "- Do not implement the product app. Do not Check with Jev. Do not edit `requirement.md`.",
    "- If you wrote questions, stop without writing product code in that same turn.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function implementPlanPrompt(briefPath: string): string {
  return [
    "Plan this Implement pass from the brief.",
    `Read ${briefPath}, docs/system.md if it exists, derived/implement-brief.md, derived/spec.json, and requirement.md.`,
    "Write derived/implement-plan.md. Do not write product code. Do not edit requirement.md.",
    "If a schema change has implications, write derived/agent-questions.json with channel plan and stop. Do not guess. Do not invent spec IDs.",
  ].join(" ");
}
