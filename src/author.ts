import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { excerptForFinding } from "./improve.js";
import { NOUL_PASS } from "./gates.js";
import { questionsBriefSection } from "./agent-questions.js";
import { stackInstruction } from "./stack.js";
import type { AdapterId, Finding, Health, ProductRepo, ReadyMeter, SpecAst } from "./types.js";

export const AUTHOR_MAX_ROUNDS = 8;
export const AUTHOR_BRIEF_FILE = "author-brief.md";
export const AUTHOR_RUN_FILE = "author-run.json";
export const AUTHOR_AGENT_LOG = "author-agent.log";
export const AUTHOR_STOPPED = "Owner stopped authoring.";
export const AUTHOR_CAPPED = `Authoring stopped after ${AUTHOR_MAX_ROUNDS} rounds. Keep editing, or Improve it once Ready is blocked.`;

export const AUTHOR_ARTIFACT_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;

export type AuthorQualityTarget = "spec_valid" | "ready";
export type AuthorRunStatus = "running" | "waiting_questions" | "done" | "stopped";

export type AuthorRun = {
  version: 1;
  status: AuthorRunStatus;
  qualityTarget: AuthorQualityTarget;
  description: string;
  round: number;
  at: string;
  specHash?: string;
  message?: string;
};

export type AuthorStepAction = "wait_questions" | "check" | "relaunch" | "done" | "capped";

export type AuthorStep = {
  action: AuthorStepAction;
  run: AuthorRun;
  message: string;
};

export type AuthorPaths = {
  id: string;
  root: string;
  requirement: string;
  personas: string;
  derived: string;
  authorBrief: string;
  authorRun: string;
  context: string;
};

export type SiblingSummary = {
  id: string;
  title: string;
  overview: string;
  specIds: string[];
  actors: string[];
};

export class AuthorLockedError extends Error {
  readonly code = "author_gate";

  constructor(message = "Authoring is already in progress.") {
    super(message);
    this.name = "AuthorLockedError";
  }
}

export class AuthorArtifactError extends Error {
  readonly code = "author_artifact";

  constructor(message: string) {
    super(message);
    this.name = "AuthorArtifactError";
  }
}

export function authorQualityTarget(hasApiKey: boolean): AuthorQualityTarget {
  return hasApiKey ? "ready" : "spec_valid";
}

export function authorQualityMet(health: Pick<Health, "spec" | "ready">, target: AuthorQualityTarget): boolean {
  if (health.spec.state !== "valid") return false;
  if (target === "spec_valid") return true;
  return health.ready.state === "ready";
}

export function shouldOfferAuthor(health: Pick<Health, "spec">, run: AuthorRun | null): boolean {
  if (run && (run.status === "running" || run.status === "waiting_questions" || run.status === "done")) {
    return false;
  }
  if (run?.status === "stopped") return health.spec.state === "empty" || health.spec.state === "drafting";
  return health.spec.state === "empty" || health.spec.state === "drafting";
}

export function isAuthorActive(run: AuthorRun | null | undefined): boolean {
  return Boolean(run && (run.status === "running" || run.status === "waiting_questions"));
}

export function parseAuthorRun(raw: unknown): AuthorRun | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (body.version !== 1) return null;
  if (body.status !== "running" && body.status !== "waiting_questions" && body.status !== "done" && body.status !== "stopped") {
    return null;
  }
  if (body.qualityTarget !== "spec_valid" && body.qualityTarget !== "ready") return null;
  if (typeof body.description !== "string" || !body.description.trim()) return null;
  if (typeof body.round !== "number" || !Number.isInteger(body.round) || body.round < 1) return null;
  if (typeof body.at !== "string" || !body.at.trim()) return null;
  return {
    version: 1,
    status: body.status,
    qualityTarget: body.qualityTarget,
    description: body.description.trim(),
    round: body.round,
    at: body.at,
    ...(typeof body.specHash === "string" ? { specHash: body.specHash } : {}),
    ...(typeof body.message === "string" ? { message: body.message } : {}),
  };
}

export async function readAuthorRun(paths: Pick<AuthorPaths, "authorRun">): Promise<AuthorRun | null> {
  try {
    return parseAuthorRun(JSON.parse(await readFile(paths.authorRun, "utf8")));
  } catch {
    return null;
  }
}

export async function writeAuthorRun(paths: Pick<AuthorPaths, "derived" | "authorRun">, run: AuthorRun): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.authorRun, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function nextAuthorStep(input: {
  run: AuthorRun;
  specState: Health["spec"]["state"];
  readyState: ReadyMeter["state"];
  jevCurrent: boolean;
  openQuestions: boolean;
  hasApiKey: boolean;
  justChecked?: boolean;
}): AuthorStep {
  const health = {
    spec: { state: input.specState, findings: [] },
    ready: { state: input.readyState } as Health["ready"],
  };
  if (input.openQuestions) {
    return {
      action: "wait_questions",
      run: { ...input.run, status: "waiting_questions", at: now(), message: "Waiting on owner questions." },
      message: "Waiting on owner questions.",
    };
  }
  if (authorQualityMet(health, input.run.qualityTarget)) {
    const message =
      input.run.qualityTarget === "ready"
        ? "Requirement meets Ready. Authoring is done."
        : "Spec is Valid. Authoring is done (no TypeSafe key, so Ready stays Not yet).";
    return {
      action: "done",
      run: { ...input.run, status: "done", at: now(), message },
      message,
    };
  }
  if (input.run.round >= AUTHOR_MAX_ROUNDS) {
    return {
      action: "capped",
      run: { ...input.run, status: "stopped", at: now(), message: AUTHOR_CAPPED },
      message: AUTHOR_CAPPED,
    };
  }
  if (
    input.run.qualityTarget === "ready" &&
    input.specState === "valid" &&
    input.hasApiKey &&
    !input.jevCurrent &&
    !input.justChecked
  ) {
    return {
      action: "check",
      run: { ...input.run, status: "running", at: now(), message: "Checking the spec with Jev." },
      message: "Checking the spec with Jev.",
    };
  }
  const round = input.run.round + 1;
  return {
    action: "relaunch",
    run: {
      ...input.run,
      status: "running",
      round,
      at: now(),
      message: `Authoring round ${round} of ${AUTHOR_MAX_ROUNDS}.`,
    },
    message: `Authoring round ${round} of ${AUTHOR_MAX_ROUNDS}.`,
  };
}

export function applyAuthorGate(health: Health, run: AuthorRun | null): Health {
  if (isAuthorActive(run) && health.stages) {
    const waiting = run?.status === "waiting_questions";
    return {
      ...health,
      howThisIsGoing: waiting ? "The agent has questions." : "Authoring this requirement.",
      nextAction: waiting
        ? health.nextAction
        : {
            id: "stop-author",
            label: "Stop",
            enabled: true,
            hint: "Stop authoring. The last requirement.md is kept.",
          },
      stages: {
        ready: { ...health.stages.ready, enabled: false, hint: "Finish authoring, or Stop, before Check or Improve." },
        build: { ...health.stages.build, enabled: false },
        proof: { ...health.stages.proof, enabled: false },
        ...(health.stages.fixFromProof ? { fixFromProof: { ...health.stages.fixFromProof, enabled: false } } : {}),
        ...(health.stages.ignoreBuild ? { ignoreBuild: { ...health.stages.ignoreBuild, enabled: false } } : {}),
        ...(health.stages.stopImplement ? { stopImplement: { ...health.stages.stopImplement, enabled: false } } : {}),
      },
    };
  }
  if (shouldOfferAuthor(health, run)) {
    return {
      ...health,
      howThisIsGoing: "Describe this requirement, then Start.",
      nextAction: {
        id: "author-start",
        label: "Start",
        enabled: true,
        hint: "Describe the requirement. The agent will ask questions until the spec is ready to compile.",
      },
    };
  }
  return health;
}

export function titleFromRequirementId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function seedAuthorMarkdown(id: string, description: string, current: string): string {
  const title = titleFromRequirementId(id);
  const overview = description.trim();
  const looksLikeTemplate =
    !current.trim() ||
    /Template guidance|Untitled Requirement|## Description/.test(current);
  if (looksLikeTemplate) {
    return [
      `# ${title}`,
      "",
      "## Overview",
      "",
      overview,
      "",
      "## Business Rules",
      "",
      "## Use Cases",
      "",
      "## Roles & Permissions",
      "",
    ].join("\n");
  }
  if (/^## Overview\s*$/m.test(current) || /^## Overview$/m.test(current)) {
    return replaceOverview(current, overview);
  }
  const titled = current.replace(/^#\s+.+$/m, `# ${title}`);
  if (/^## Overview\b/m.test(titled)) return replaceOverview(titled, overview);
  const match = titled.match(/^#\s+.+$/m);
  if (!match || match.index === undefined) {
    return `# ${title}\n\n## Overview\n\n${overview}\n\n${titled}`;
  }
  const insertAt = match.index + match[0].length;
  return `${titled.slice(0, insertAt)}\n\n## Overview\n\n${overview}\n${titled.slice(insertAt)}`;
}

function replaceOverview(markdown: string, overview: string): string {
  return markdown.replace(/## Overview\n+[\s\S]*?(?=\n## |\n#[^#]|$)/, `## Overview\n\n${overview}\n`);
}

export function summarizeRequirementMarkdown(id: string, markdown: string): SiblingSummary {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || id.replaceAll("-", " ");
  const overviewBlock = markdown.match(/## Overview\n+([\s\S]*?)(?=\n## |\n#[^#]|$)/);
  const overview = (overviewBlock?.[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 280);
  const specIds = [...markdown.matchAll(/\b((?:BR|UC)-\d{3})\b/g)].map((match) => match[1] ?? "");
  const actors = [
    ...new Set(
      [...markdown.matchAll(/^Actor:\s*(.+)$/gm)].map((match) => match[1]?.trim() ?? "").filter(Boolean),
    ),
  ];
  return {
    id,
    title,
    overview,
    specIds: [...new Set(specIds)].slice(0, 24),
    actors: actors.slice(0, 12),
  };
}

export function emitAuthorBrief(input: {
  id: string;
  description: string;
  qualityTarget: AuthorQualityTarget;
  round: number;
  markdown: string;
  compileFindings: Finding[];
  spec: SpecAst | null;
  ready: ReadyMeter | null;
  siblings: SiblingSummary[];
  product: { empty: boolean; stack: string; adapter: AdapterId; layout: string; instruction: string };
  contextFiles: string[];
}): string {
  const target =
    input.qualityTarget === "ready"
      ? `Ready Clear: pack noul at or above ${NOUL_PASS.toFixed(2)}, zero blockers. The host Checks with Jev after Spec Valid. Do not fake scores.`
      : "Spec Valid (frozen grammar). There is no TypeSafe key, so stop once the compiler is Valid. Ready may stay Not yet.";
  const lines = [
    `# Author: ${input.id}`,
    "",
    "Fill this requirement pack from the owner's description. Do not guess. Do not implement the product app.",
    `This is authoring round ${input.round} of ${AUTHOR_MAX_ROUNDS}.`,
    "",
    "## Goal",
    "",
    `- Quality bar: ${target}`,
    "- Align substance to a high-quality requirement (roles, permissions, business rules, use cases, observables, deny paths) while writing **frozen grammar** so the compiler can parse it.",
    "",
    "## Owner description",
    "",
    input.description.trim() || "(empty)",
    "",
    "## Frozen grammar",
    "",
    "Replace the starter template. Allowed `##` headings only:",
    "",
    "- Required: `Business Rules`, `Use Cases`, `Roles & Permissions`",
    "- Optional: `Overview`, `Out of scope`, `Open questions`, `Entities`, `UI notes`",
    "- Put the owner's description in `## Overview`. Do not emit `## Description` or template guidance labels.",
    "- Each business rule: `Id: BR-NNN`, Statement, Observable (what a person or test notices).",
    "- Each use case: `Id: UC-NNN`, Actor (a matrix column), Preconditions, numbered Steps with `Open` / `Choose` / `Look for` / `Select`, Outcome of what a person sees.",
    "- `Choose` is allow. `Look for` is deny. Matrix cells are only `allow` or `deny`.",
    "- You may assign the **first** BR- and UC- IDs in this pack. Do not reuse sibling IDs. Do not invent product stack, auth, storage, copy, or screens the owner did not confirm or upload.",
    "- Edit `fixtures/personas.yaml` only when a role is confirmed (email `role-slug@example.test`, password `test-only-not-production`).",
    "",
    "## Current requirement.md",
    "",
    "~~~~markdown",
    input.markdown.trim() || "(empty)",
    "~~~~",
    "",
    "## Compile findings",
    "",
  ];

  if (!input.compileFindings.length) {
    lines.push("None. Spec grammar is Valid." , "");
  } else {
    for (const finding of input.compileFindings) {
      lines.push(`- L${finding.line} ${finding.severity}: ${finding.message}`);
    }
    lines.push("");
  }

  if (input.ready && input.spec) {
    lines.push("## Ready findings", "");
    lines.push(`- Ready is ${input.ready.state} (${input.ready.blockers} blocker${input.ready.blockers === 1 ? "" : "s"}, ${input.ready.nits} nit${input.ready.nits === 1 ? "" : "s"}).`);
    if (typeof input.ready.packNoul === "number") {
      lines.push(`- Pack noul is ${input.ready.packNoul.toFixed(2)}. Gate ${NOUL_PASS.toFixed(2)}.`);
    }
    lines.push("");
    if (!input.ready.findings.length) {
      lines.push("No Ready findings.", "");
    } else {
      for (const [index, finding] of input.ready.findings.entries()) {
        lines.push(`### ${index + 1}. ${finding.specId ?? finding.id}`, "");
        lines.push(`- Kind: ${finding.kind}`);
        lines.push(`- Severity: ${finding.severity}`);
        lines.push(`- Message: ${finding.message}`, "");
        lines.push(...excerptForFinding(finding, input.spec));
      }
    }
  }

  lines.push("## Sibling packs", "", "Match density and grammar. Do not copy IDs or steal this pack's scope.", "");
  if (!input.siblings.length) {
    lines.push("No other packs in this repo.", "");
  } else {
    for (const sibling of input.siblings) {
      lines.push(`### ${sibling.id}`, "");
      lines.push(`- Title: ${sibling.title}`);
      if (sibling.overview) lines.push(`- Overview: ${sibling.overview}`);
      if (sibling.actors.length) lines.push(`- Actors: ${sibling.actors.join(", ")}`);
      if (sibling.specIds.length) lines.push(`- Spec IDs: ${sibling.specIds.join(", ")}`);
      lines.push("");
    }
  }

  lines.push("## Product repo", "");
  lines.push(`- ${input.product.instruction}`);
  lines.push(`- Stack: ${input.product.stack}. Adapter: ${input.product.adapter}.`);
  lines.push(`- Top-level: ${input.product.layout || "(none listed)"}`);
  lines.push("- Read existing screens, roles, and routes. Do not scaffold a second application.", "");
  lines.push("## context/ artifacts", "");
  if (!input.contextFiles.length) {
    lines.push("None yet. If you need a screenshot, ask with `kind: \"artifact\"`. The owner may skip.", "");
  } else {
    lines.push("Read each file (images included) and update the spec from what you see. Do not invent UI the files do not show.", "");
    for (const file of input.contextFiles) lines.push(`- context/${file}`);
    lines.push("");
  }

  lines.push(
    "## Opinionated rules",
    "",
    "- Prefer asking over assuming. One round, at most four questions, then stop if you wrote questions.",
    "- Recommended choice first. Set `allowCustom` when none of the options may fit.",
    "- If the owner skipped, leave that area incomplete or ask a *different* question. Never fill skipped gaps with guesses.",
    "- Observables and Outcomes are what a person sees: a status or label, and whether a named control is present, absent, or disabled.",
    "- Do not write matrix talk in Outcome (`is allow`, `is deny`).",
    "- Conditional template topics (definitions, data, states, empty/error paths) belong in Entities, rules, and use cases when they matter.",
    "",
    questionsBriefSection({ channel: "author", inventIds: true }).trimEnd(),
    "",
    "## Fence",
    "",
    "- Patch `requirement.md` (and personas.yaml only when a role is confirmed).",
    "- Do not implement the product app. Do not Check with Jev yourself; the host will.",
    "- If you wrote `derived/agent-questions.json`, stop without patching in that same turn.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

export function authorPrompt(briefPath: string): string {
  return [
    "Author this requirement pack from the brief.",
    `Read ${briefPath} and requirement.md.`,
    "Write frozen-grammar requirement.md. You may assign the first BR- and UC- IDs. Do not copy sibling IDs.",
    "If a required decision is missing, write derived/agent-questions.json with channel author and stop. Do not guess. Do not patch requirement.md in that same turn.",
    "Read files in context/ including images. Do not invent UI the owner did not confirm or upload.",
    "You may edit fixtures/personas.yaml when a role is confirmed. Do not implement the product app. Do not Check with Jev.",
  ].join(" ");
}

export function sanitizeArtifactFilename(filename: string, mime: string): string {
  const ext = AUTHOR_ARTIFACT_MIMES[mime];
  if (!ext) {
    throw new AuthorArtifactError("Upload a PNG, JPG, or WebP image.");
  }
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const stem = base.replace(/\.[a-zA-Z0-9]+$/, "") || "artifact";
  return `${stem.slice(0, 80)}${ext}`;
}

export function decodeArtifactData(raw: string, mime: string): Buffer {
  const ext = AUTHOR_ARTIFACT_MIMES[mime];
  if (!ext) throw new AuthorArtifactError("Upload a PNG, JPG, or WebP image.");
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    throw new AuthorArtifactError("Could not read the upload.");
  }
  if (!bytes.length) throw new AuthorArtifactError("Upload is empty.");
  if (bytes.length > ARTIFACT_MAX_BYTES) {
    throw new AuthorArtifactError("Upload must be 5 MB or smaller.");
  }
  return bytes;
}

export async function writeAuthorArtifact(
  paths: Pick<AuthorPaths, "context">,
  filename: string,
  mime: string,
  data: string,
): Promise<string> {
  const safe = sanitizeArtifactFilename(filename, mime);
  const bytes = decodeArtifactData(data, mime);
  await mkdir(paths.context, { recursive: true });
  await writeFile(path.join(paths.context, safe), bytes);
  return safe;
}

export async function listContextFiles(paths: Pick<AuthorPaths, "context">): Promise<string[]> {
  try {
    const entries = await readdir(paths.context, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function listProductLayout(repoRoot: string | null): Promise<string> {
  if (!repoRoot) return "(no product repo)";
  try {
    const entries = await readdir(repoRoot, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 24)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .join(", ");
  } catch {
    return "(unreadable)";
  }
}

export function productBriefBits(repo: ProductRepo, layout: string): {
  empty: boolean;
  stack: string;
  adapter: AdapterId;
  layout: string;
  instruction: string;
} {
  return {
    empty: repo.empty,
    stack: repo.stack.label,
    adapter: repo.adapter,
    layout,
    instruction: stackInstruction(repo, repo.adapter),
  };
}

function now(): string {
  return new Date().toISOString();
}
