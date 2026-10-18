import { JEV_CATALOG, SECTION_SCORE_LEVELS } from "./gates.js";
import type { LoadedStandards } from "./standards.js";
import type { JevPack, JevQuestion, SpecAst } from "./types.js";

const JEV_STATE_CLIP = 8_000;
const STD_STATE_CLIP = 4_000;

export type JevPackContext = {
  markdown?: string;
  contextFiles?: string[];
  standards?: LoadedStandards | null;
};

export const STD_DOCUMENT_QUESTIONS = [
  {
    id: "std.document.title-names-problem",
    instructions: "Does the title name the problem or capability rather than the solution?",
    pass: "The # title is a problem or capability. It does not prescribe a solution or say 'the system shall'.",
    fail: "The title names a solution, a stack, or a system-shall statement.",
  },
  {
    id: "std.document.overview-intent",
    instructions: "Is Overview two to four sentences of actor, capability, and outcome — not a numbered rule list?",
    pass: "Overview states who, what, and the outcome. Numbered rules live under Business Rules.",
    fail: "Overview is missing, or it lists rules, IDs, or implementation steps instead of intent.",
  },
  {
    id: "std.document.definitions-glossary",
    instructions: "If Definitions exist, are they glossary only — not hidden business rules?",
    pass: "Definitions (if present) name terms. Behaviour is in BR- rules. Missing Definitions is fine when no glossary is needed.",
    fail: "Definitions contain obligations, permissions, or exceptions that belong in Business Rules.",
  },
  {
    id: "std.document.data-not-behaviour",
    instructions: "If Data Definition exists, does it describe data rather than behaviour?",
    pass: "Data Definition (if present) covers records, uniqueness, or derived fields. Behaviour is a rule or use case. Missing Data Definition is fine when data is obvious.",
    fail: "Data Definition hides workflow, permissions, or observables that belong in BR- or UC- entries.",
  },
  {
    id: "std.document.rules-atomic-observable",
    instructions: "Is each business rule one atomic obligation with a noticeable Observable, and are exceptions sibling BR- rules?",
    pass: "Each BR-NNN is one rule. Statement plus Observable make association (user, record, role) noticeable. Exceptions are separate IDs.",
    fail: "A rule bundles multiple obligations, lacks a noticeable Observable, or buries exceptions in prose.",
  },
  {
    id: "std.document.usecases-complete",
    instructions: "Does each use case have actor, intent-named title, numbered steps, observable Outcome, and deny/empty/error paths that matter?",
    pass: "UC- entries use frozen step verbs, Outcomes a person can see, and cover allow plus material deny or empty paths.",
    fail: "A use case is UI-pixel named, missing Outcome, or omits a deny/empty/error path the rules imply.",
  },
  {
    id: "std.document.matrix-allow-deny",
    instructions: "Is the roles matrix complete with allow/deny only and consistent with the business rules?",
    pass: "Every role and action the spec talks about appears. Cells are allow or deny. An allow cell plus a rule that hides a control is consistent.",
    fail: "The matrix omits a role or action, uses other cell values, or contradicts the rules without a Look-for use case.",
  },
  {
    id: "std.document.no-hidden-acceptance",
    instructions: "Do Implementation Notes and UI notes avoid hidden acceptance criteria?",
    pass: "Notes are builder hints. Anything a test would fail on lives in a business rule or use case. Missing notes is fine.",
    fail: "Implementation Notes, UI notes, or similar prose is the only place an acceptance criterion appears.",
  },
  {
    id: "std.document.related-not-restated",
    instructions: "If Related Requirements exist, are they pointers rather than a restatement of this pack's rules?",
    pass: "Related Requirements (if present) name other packs. This pack's obligations stay in its BR- and UC- entries.",
    fail: "Related Requirements copy or replace this pack's rules.",
  },
] as const;

export const STD_PACK_QUESTIONS = [
  {
    id: "std.pack.screenshots-not-spec",
    instructions: "Is requirement.md the canonical spec, with screenshots only illustrating stated behaviour?",
    pass: "Every behaviour a screenshot shows is also in a business rule or use case. Images do not introduce unstated behaviour.",
    fail: "A screenshot or mock is the only place a behaviour is specified.",
  },
  {
    id: "std.pack.artifacts-named-referenced",
    instructions: "Are context/ files named {UC-id}__{purpose}.ext and referenced from the matching use case?",
    pass: "Existing context files follow UC-001__purpose.ext (or are pack-level and mentioned in Overview). Each is referenced. Empty context/ is fine.",
    fail: "A context file exists but is unnamed, unreferenced, or uses a layout other than this pack's context/ folder.",
  },
  {
    id: "std.pack.artifacts-current",
    instructions: "Do referenced context/ files still match the use cases they illustrate?",
    pass: "Filenames and mentions line up with current UC- IDs. Empty context/ is fine.",
    fail: "A screenshot name or caption points at a use case that no longer exists or was renamed.",
  },
  {
    id: "std.pack.association-observable",
    instructions: "Is the association between actor, record, and permission noticeable in rules or outcomes?",
    pass: "A person or test can tell which user, which record, and which role apply from Observables and Outcomes.",
    fail: "Association is implied ('the right user sees the right record') without a noticeable Observable.",
  },
  {
    id: "std.pack.verification-coverage",
    instructions: "Is every BR- and UC- exercisable through use cases or verification scenarios — not only implementation notes?",
    pass: "Each ID can be checked from a use case or Verification Scenarios. Notes are not the only coverage.",
    fail: "A rule or use case has no path a person could follow, or coverage lives only in Implementation Notes.",
  },
  {
    id: "std.pack.completeness",
    instructions: "Does the pack have roles, business rules, use cases, a consistent matrix, and referenced artifacts when files exist?",
    pass: "The pack is complete enough that an agent would not invent roles, rules, or screenshot-only behaviour.",
    fail: "A required piece is missing in substance, or artifacts exist without being part of the spec.",
  },
] as const;

export function emitJevPack(spec: SpecAst, context: JevPackContext = {}): JevPack {
  const questions: JevQuestion[] = [];
  const contextFiles = context.contextFiles ?? [];
  const packStandard = clip(context.standards?.pack.text ?? "", JEV_STATE_CLIP);
  const documentStandard = clip(context.standards?.document.text ?? "", JEV_STATE_CLIP);
  const optionalPresent = Object.entries(spec.optional)
    .filter(([, body]) => body?.trim())
    .map(([name]) => name);

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
      true: "Rules are testable, use cases match the matrix, house standards are met in substance, and an agent would not have to invent behavior.",
      false: "An agent would have to guess, the pack still contradicts itself, or it ignores the house pack/document standards.",
    },
    state: {
      ruleIds: spec.businessRules.map((rule) => rule.id),
      useCaseIds: spec.useCases.map((useCase) => useCase.id),
      roles: spec.matrix.roles,
      optionalPresent,
      contextFiles,
      housePackStandard: packStandard,
      houseDocumentStandard: documentStandard,
      housePackPath: context.standards?.pack.path ?? "",
      houseDocumentPath: context.standards?.document.path ?? "",
    },
  });

  const stdState = {
    title: spec.title,
    markdown: clip(context.markdown ?? "", STD_STATE_CLIP),
    ruleIds: spec.businessRules.map((rule) => rule.id),
    useCaseIds: spec.useCases.map((useCase) => useCase.id),
    roles: spec.matrix.roles,
    optionalPresent,
    contextFiles,
    housePackStandard: clip(context.standards?.pack.text ?? "", STD_STATE_CLIP),
    houseDocumentStandard: clip(context.standards?.document.text ?? "", STD_STATE_CLIP),
  };

  for (const item of STD_DOCUMENT_QUESTIONS) {
    questions.push({
      id: item.id,
      type: "noul",
      instructions: item.instructions,
      criteria: { true: item.pass, false: item.fail },
      state: stdState,
    });
  }
  for (const item of STD_PACK_QUESTIONS) {
    questions.push({
      id: item.id,
      type: "noul",
      instructions: item.instructions,
      criteria: { true: item.pass, false: item.fail },
      state: stdState,
    });
  }

  return {
    requirementId: spec.requirementId,
    catalog: JEV_CATALOG,
    questions,
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
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
