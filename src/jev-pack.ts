import { JEV_CATALOG, SECTION_SCORE_LEVELS } from "./gates.js";
import type { JevPack, JevQuestion, SpecAst } from "./types.js";

export function emitJevPack(spec: SpecAst): JevPack {
  const questions: JevQuestion[] = [];

  for (const rule of spec.businessRules) {
    questions.push({
      id: `rule.observable.${rule.id}`,
      type: "noul",
      specId: rule.id,
      instructions: "Is Statement observable via Observable?",
      criteria: {
        true: "A person or automated test could notice the Observable if the Statement holds or is violated.",
        false: "The Observable is vague, missing, or not something a test could notice.",
      },
      state: {
        id: rule.id,
        title: rule.title,
        statement: rule.statement,
        observable: rule.observable,
      },
    });
  }

  for (const useCase of spec.useCases) {
    const actorPermissions: Record<string, string> = {};
    for (const action of spec.matrix.actions) {
      const cell = action.permissions[useCase.actor];
      if (cell) actorPermissions[action.id] = cell;
    }
    questions.push({
      id: `usecase.contradicts.${useCase.id}`,
      type: "noul",
      specId: useCase.id,
      instructions: "Does this contradict the matrix for its Actor?",
      criteria: {
        true: "A step or outcome asks the actor to do something the Roles & Permissions matrix denies, or forbids something the matrix allows.",
        false: "The use case stays inside the actor's allow/deny cells.",
      },
      state: {
        id: useCase.id,
        title: useCase.title,
        actor: useCase.actor,
        preconditions: useCase.preconditions,
        steps: useCase.steps,
        outcome: useCase.outcome,
        actorPermissions,
      },
    });
  }

  questions.push(
    sectionScore(
      "Business Rules",
      spec.businessRules.map((rule) => ({
        id: rule.id,
        statement: rule.statement,
        observable: rule.observable,
      })),
    ),
    sectionScore(
      "Use Cases",
      spec.useCases.map((useCase) => ({
        id: useCase.id,
        actor: useCase.actor,
        steps: useCase.steps,
        outcome: useCase.outcome,
      })),
    ),
    sectionScore("Roles & Permissions", {
      roles: spec.matrix.roles,
      actions: spec.matrix.actions.map((action) => ({
        id: action.id,
        permissions: action.permissions,
      })),
    }),
  );

  const choiceCriteria: Record<string, string> = {};
  for (const rule of spec.businessRules) {
    choiceCriteria[rule.id] = `Business rule: ${rule.title}`;
  }
  for (const useCase of spec.useCases) {
    choiceCriteria[useCase.id] = `Use case: ${useCase.title}`;
  }
  if (Object.keys(choiceCriteria).length > 0) {
    questions.push({
      id: "pack.next-id",
      type: "choice",
      instructions: "Which ID should the Requirement Owner improve next?",
      criteria: choiceCriteria,
      state: {
        ids: Object.keys(choiceCriteria),
        titles: choiceCriteria,
      },
    });
  }

  questions.push({
    id: "pack.agent-ready",
    type: "noul",
    instructions: "Is this pack safe to hand to a coding agent?",
    criteria: {
      true: "Rules are testable, use cases match the matrix, and an agent would not have to invent behavior.",
      false: "An agent would have to guess, or the pack still contradicts itself.",
    },
    state: {
      ruleIds: spec.businessRules.map((rule) => rule.id),
      useCaseIds: spec.useCases.map((useCase) => useCase.id),
      roles: spec.matrix.roles,
    },
  });

  return {
    requirementId: spec.requirementId,
    catalog: JEV_CATALOG,
    questions,
  };
}

function sectionScore(section: string, body: unknown): JevQuestion {
  const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: `section.score.${slug}`,
    type: "score",
    section,
    instructions: `How complete is the ${section} section for a coding agent?`,
    criteria: [...SECTION_SCORE_LEVELS],
    state: { section, body },
  };
}
