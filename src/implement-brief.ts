import type { PersonasResult } from "./personas.js";
import { DEFAULT_STACK, stackInstruction } from "./stack.js";
import type { AdapterId, ProductRepo, SpecAst } from "./types.js";

export function emitImplementBrief(input: {
  spec: SpecAst;
  repo: ProductRepo;
  adapter: AdapterId;
  personas?: PersonasResult;
}): string {
  const { spec, repo, adapter, personas } = input;
  const lines: string[] = [
    `# Implement: ${spec.title}`,
    "",
    "Portable coding-agent brief. Read this file, then the compiled `derived/spec.json`. Do not invent rule, use-case, or role IDs.",
    "",
    "## Stack",
    "",
    stackInstruction(repo, adapter),
    "",
    `Default stack (empty repo only): ${DEFAULT_STACK.label}.`,
    "",
    "## Overview",
    "",
    spec.optional.Overview?.trim() || "See the business rules and use cases.",
    "",
  ];

  if (spec.optional["Out of scope"]?.trim()) {
    lines.push("## Out of scope", "", spec.optional["Out of scope"].trim(), "");
  }

  lines.push(
    "## Acceptance criteria (business rules)",
    "",
    "Each rule is an acceptance criterion. Implement the Observable, not a paraphrase.",
    "",
  );
  for (const rule of spec.businessRules) {
    lines.push(`### ${rule.id} — ${rule.title}`, "", `- Statement: ${rule.statement}`, `- Observable: ${rule.observable}`, "");
  }

  lines.push("## Flows (use cases)", "");
  for (const useCase of spec.useCases) {
    lines.push(`### ${useCase.id} — ${useCase.title}`, "", `- Actor: ${useCase.actor}`, `- Preconditions: ${useCase.preconditions}`, "- Steps:");
    useCase.steps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step}`);
    });
    lines.push(`- Outcome: ${useCase.outcome}`);
    if (useCase.alternatePaths) lines.push(`- Alternate paths: ${useCase.alternatePaths}`);
    lines.push("");
  }

  lines.push("## Authorization (roles and permissions)", "", `| Action | ${spec.matrix.roles.join(" | ")} |`, `| --- | ${spec.matrix.roles.map(() => "---").join(" | ")} |`);
  for (const action of spec.matrix.actions) {
    const cells = spec.matrix.roles.map((role) => action.permissions[role] ?? "");
    lines.push(`| ${action.id} | ${cells.join(" | ")} |`);
  }
  lines.push("", "Permission checks belong on the server, not only hidden buttons.", "");

  lines.push("## Personas (test only)", "", "Never production credentials. Seed these users so role QA can log in later.", "");
  if (personas && personas.personas.size > 0) {
    for (const persona of personas.personas.values()) {
      lines.push(`- ${persona.role}: ${persona.email}`);
    }
    lines.push("", "Passwords and extras: `fixtures/personas.yaml`.", "");
  } else {
    lines.push("No personas parsed. See `fixtures/personas.yaml`. Ready will block Implement until each matrix role has one.", "");
  }

  if (spec.optional.Entities?.trim()) {
    lines.push("## Entities", "", spec.optional.Entities.trim(), "");
  }
  if (spec.optional["UI notes"]?.trim()) {
    lines.push("## UI notes", "", spec.optional["UI notes"].trim(), "");
  }
  if (spec.optional["Open questions"]?.trim()) {
    lines.push("## Open questions", "", spec.optional["Open questions"].trim(), "");
  }

  lines.push(
    "## Security baseline",
    "",
    "- No production credentials in the spec or this brief.",
    "- Secrets via environment variables.",
    "- Personas are test-only.",
    "",
    "## Done means",
    "",
    "A coding-agent run finishing is **Build Succeeded**, not “the app boots.” Boot and login are Proof (Milestone 4).",
    "",
  );

  return `${lines.join("\n")}\n`;
}
