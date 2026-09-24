import { specHash } from "./ready.js";
import type { QaCaseKind, QaPlan, SpecAst, UseCase } from "./types.js";

export type { QaCase, QaCaseKind, QaPlan } from "./types.js";

export function emitQaPlan(spec: SpecAst): QaPlan {
  return {
    requirementId: spec.requirementId,
    specHash: specHash(spec),
    cases: spec.useCases.map((useCase) => ({
      id: useCase.id,
      specId: useCase.id,
      kind: caseKind(useCase),
      actor: useCase.actor,
      control: controlName(useCase),
      steps: useCase.steps,
      preconditions: useCase.preconditions,
      outcome: useCase.outcome,
    })),
  };
}

export function caseKind(useCase: UseCase): QaCaseKind {
  if (useCase.steps.some((step) => /^look for\b/i.test(step))) return "deny";
  // Choose is allow. After-success wording like "absent or disabled" is the new state, not a deny.
  if (useCase.steps.some((step) => /^choose\b/i.test(step))) return "allow";
  if (/\b(not available|absent or disabled|is unchanged)\b/i.test(useCase.outcome)) {
    return "deny";
  }
  return "allow";
}

export function controlName(useCase: UseCase): string | null {
  for (const step of useCase.steps) {
    const match = step.match(/^(?:Look for|Choose)\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function emitQaPlanYaml(plan: QaPlan): string {
  const lines = [
    `requirementId: ${yamlScalar(plan.requirementId)}`,
    `specHash: ${yamlScalar(plan.specHash)}`,
    "cases:",
  ];
  for (const item of plan.cases) {
    lines.push(
      `  - id: ${yamlScalar(item.id)}`,
      `    specId: ${yamlScalar(item.specId)}`,
      `    kind: ${item.kind}`,
      `    actor: ${yamlScalar(item.actor)}`,
      `    control: ${item.control ? yamlScalar(item.control) : "null"}`,
      `    preconditions: ${yamlScalar(item.preconditions)}`,
      `    outcome: ${yamlScalar(item.outcome)}`,
      "    steps:",
    );
    for (const step of item.steps) {
      lines.push(`      - ${yamlScalar(step)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function yamlScalar(value: string): string {
  if (value === "") return '""';
  if (/[:#\n'"{}[\],&*?|<>=!%@`]|^\s|\s$|^[-?]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
