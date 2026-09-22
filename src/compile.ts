import { emptyReady } from "./ready.js";
import {
  OPTIONAL_H2,
  REQUIRED_H2,
  type BusinessRule,
  type CompileResult,
  type Finding,
  type Health,
  type OptionalH2,
  type Permission,
  type PermissionMatrix,
  type SpecAst,
  type UseCase,
} from "./types.js";

const REQUIRED_SET = new Set<string>(REQUIRED_H2);
const OPTIONAL_SET = new Set<string>(OPTIONAL_H2);
const ALLOWED_H2 = new Set<string>([...REQUIRED_H2, ...OPTIONAL_H2]);

const RULE_ID = /^BR-\d{3}$/;
const USE_CASE_ID = /^UC-\d{3}$/;
const ACTION_ID = /^[A-Za-z][A-Za-z0-9-]*$/;
const FOLDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD = /^(?:-\s*)?([A-Za-z][A-Za-z ]*):[ \t]*(.*)$/;
const NUMBERED = /^(\d+)\.\s+(.*)$/;
const H1 = /^#\s+(.+)$/;
const H2 = /^##\s+(.+)$/;
const H3 = /^###\s+(.+)$/;

export function isRequirementId(id: string): boolean {
  return FOLDER_ID.test(id);
}

export function compileMarkdown(
  requirementId: string,
  markdown: string,
): CompileResult {
  const findings: Finding[] = [];
  const note = (line: number, message: string, severity: Finding["severity"] = "error") => {
    findings.push({ line, severity, message });
  };

  if (!isRequirementId(requirementId)) {
    note(1, `Requirement folder must be kebab-case [a-z0-9-]+ (got "${requirementId}").`);
  }

  const trimmed = markdown.replace(/^\uFEFF/, "");
  if (trimmed.trim().length === 0) {
    return {
      spec: null,
      markdown,
      health: buildHealth(requirementId, "empty", [
        { line: 1, severity: "error", message: "requirement.md is empty. Create the requirement to start." },
      ]),
    };
  }

  const lines = trimmed.split(/\r?\n/);
  let title = "";
  let titleLine = 0;
  const h2Blocks: { title: string; line: number; body: string[]; start: number }[] = [];
  let current: { title: string; line: number; body: string[]; start: number } | null = null;
  const seenH2 = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    const h1 = raw.match(H1);
    const h2 = raw.match(H2);
    if (h1 && !raw.startsWith("##")) {
      if (title) {
        note(lineNo, "Only one top-level heading is allowed.");
      } else {
        title = h1[1]?.trim() ?? "";
        titleLine = lineNo;
      }
      continue;
    }
    if (h2) {
      const heading = h2[1]?.trim() ?? "";
      if (!ALLOWED_H2.has(heading)) {
        note(lineNo, `Unknown section "## ${heading}". Allowed optional sections: ${OPTIONAL_H2.join(", ")}.`);
      }
      const prev = seenH2.get(heading);
      if (prev) {
        note(lineNo, `Duplicate section "## ${heading}" (already at line ${prev}).`);
      } else {
        seenH2.set(heading, lineNo);
      }
      current = { title: heading, line: lineNo, body: [], start: lineNo };
      h2Blocks.push(current);
      continue;
    }
    if (current) current.body.push(raw);
  }

  if (!title) {
    note(1, "Missing top-level heading (# Requirement title).");
  }

  for (const required of REQUIRED_H2) {
    if (!seenH2.has(required)) {
      note(titleLine || 1, `Missing required section "## ${required}".`);
    }
  }

  const optional: Partial<Record<OptionalH2, string>> = {};
  let businessRules: BusinessRule[] = [];
  let useCases: UseCase[] = [];
  let matrix: PermissionMatrix = { roles: [], actions: [] };

  for (const block of h2Blocks) {
    if (!ALLOWED_H2.has(block.title)) continue;
    if (OPTIONAL_SET.has(block.title)) {
      optional[block.title as OptionalH2] = block.body.join("\n").trim();
      continue;
    }
    if (block.title === "Business Rules") {
      businessRules = parseRules(block.body, block.line, note);
    } else if (block.title === "Use Cases") {
      useCases = parseUseCases(block.body, block.line, note);
    } else if (block.title === "Roles & Permissions") {
      matrix = parseMatrix(block.body, block.line, note);
    }
  }

  const ids = new Map<string, number>();
  for (const item of [...businessRules, ...useCases]) {
    const existing = ids.get(item.id);
    if (existing) {
      note(item.line, `Duplicate id ${item.id} (already at line ${existing}).`);
    } else if (item.id) {
      ids.set(item.id, item.line);
    }
  }

  const roleSet = new Set(matrix.roles);
  for (const uc of useCases) {
    if (uc.actor && roleSet.size > 0 && !roleSet.has(uc.actor)) {
      note(
        uc.line,
        `Use case ${uc.id || uc.title} actor "${uc.actor}" is not a column in Roles & Permissions.`,
      );
    }
  }

  const hasStructure =
    Boolean(seenH2.get("Business Rules")) &&
    Boolean(seenH2.get("Use Cases")) &&
    Boolean(seenH2.get("Roles & Permissions"));
  const hasContent =
    businessRules.length > 0 && useCases.length > 0 && matrix.actions.length > 0;
  const errors = findings.filter((f) => f.severity === "error");

  if (hasStructure && !hasContent && errors.length === 0) {
    if (businessRules.length === 0) {
      note(seenH2.get("Business Rules") ?? 1, "Business Rules needs at least one rule.");
    }
    if (useCases.length === 0) {
      note(seenH2.get("Use Cases") ?? 1, "Use Cases needs at least one use case.");
    }
    if (matrix.actions.length === 0) {
      note(seenH2.get("Roles & Permissions") ?? 1, "Roles & Permissions needs at least one action row.");
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const spec: SpecAst | null =
    errorCount === 0 && hasContent
      ? { requirementId, title, optional, businessRules, useCases, matrix }
      : null;

  let specState: Health["spec"]["state"] = "drafting";
  if (!hasStructure && errorCount > 0 && businessRules.length === 0 && useCases.length === 0) {
    const onlyEmpty = trimmed.trim().length < 80 && !hasStructure;
    if (onlyEmpty && !seenH2.size) specState = "empty";
  }
  if (spec) specState = "valid";
  if (!spec && looksEmpty(trimmed, seenH2.size)) specState = "empty";

  return { spec, markdown, health: buildHealth(requirementId, specState, findings) };
}

function looksEmpty(markdown: string, h2Count: number): boolean {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
  return text.length === 0 || (h2Count === 0 && text.split("\n").length <= 2);
}

function parseRules(
  body: string[],
  sectionLine: number,
  note: (line: number, message: string) => void,
): BusinessRule[] {
  const blocks = splitH3(body, sectionLine);
  const rules: BusinessRule[] = [];
  if (blocks.length === 0) return rules;

  for (const block of blocks) {
    const fields = collectFields(block.lines, block.line);
    const id = fields.get("id")?.value.trim() ?? "";
    const statement = fields.get("statement")?.value.trim() ?? "";
    const observable = fields.get("observable")?.value.trim() ?? "";
    if (!RULE_ID.test(id)) {
      note(fields.get("id")?.line ?? block.line, `Business rule id must match BR-NNN (got "${id || "missing"}").`);
    }
    if (!statement) {
      note(block.line, `Business rule ${id || block.title} is missing Statement.`);
    }
    if (!observable) {
      note(block.line, `Business rule ${id || block.title} is missing Observable.`);
    }
    rules.push({
      id,
      title: block.title,
      statement,
      observable,
      line: block.line,
    });
  }
  return rules;
}

function parseUseCases(
  body: string[],
  sectionLine: number,
  note: (line: number, message: string) => void,
): UseCase[] {
  const blocks = splitH3(body, sectionLine);
  const useCases: UseCase[] = [];

  for (const block of blocks) {
    const { fields, steps } = collectUseCase(block.lines, block.line);
    const id = fields.get("id")?.value.trim() ?? "";
    const actor = fields.get("actor")?.value.trim() ?? "";
    const preconditions = fields.get("preconditions")?.value.trim() ?? "";
    const outcome = fields.get("outcome")?.value.trim() ?? "";
    const alternatePaths = fields.get("alternate paths")?.value.trim() || undefined;

    if (!USE_CASE_ID.test(id)) {
      note(fields.get("id")?.line ?? block.line, `Use case id must match UC-NNN (got "${id || "missing"}").`);
    }
    if (!actor) note(block.line, `Use case ${id || block.title} is missing Actor.`);
    if (!preconditions) note(block.line, `Use case ${id || block.title} is missing Preconditions.`);
    if (steps.length === 0) note(block.line, `Use case ${id || block.title} needs numbered Steps.`);
    if (!outcome) note(block.line, `Use case ${id || block.title} is missing Outcome.`);

    useCases.push({
      id,
      title: block.title,
      actor,
      preconditions,
      steps,
      outcome,
      alternatePaths,
      line: block.line,
    });
  }
  return useCases;
}

function parseMatrix(
  body: string[],
  sectionLine: number,
  note: (line: number, message: string) => void,
): PermissionMatrix {
  const startLine = sectionLine + 1;
  const tableLines: { line: number; cells: string[] }[] = [];

  for (let i = 0; i < body.length; i++) {
    const raw = body[i] ?? "";
    const line = startLine + i;
    if (!raw.trim().startsWith("|")) continue;
    const cells = raw
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;
    tableLines.push({ line, cells });
  }

  if (tableLines.length < 2) {
    note(sectionLine, "Roles & Permissions needs a markdown table with a header and at least one action row.");
    return { roles: [], actions: [] };
  }

  const header = tableLines[0];
  if (!header) return { roles: [], actions: [] };
  const actionHeader = header.cells[0] ?? "";
  if (actionHeader !== "Action") {
    note(header.line, `First column must be titled "Action" (got "${actionHeader}").`);
  }
  const roles = header.cells.slice(1);
  if (roles.length === 0) {
    note(header.line, "Roles & Permissions table needs at least one role column.");
  }
  const dup = new Map<string, number>();
  for (const role of roles) {
    if (!role) note(header.line, "Role column header cannot be blank.");
    const prev = dup.get(role);
    if (prev) note(header.line, `Duplicate role column "${role}".`);
    else dup.set(role, 1);
  }

  const maybeSep = tableLines[1];
  const sepIsSep =
    maybeSep &&
    maybeSep.cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")) || /^:?-+:?$/.test(c));
  const rows = sepIsSep ? tableLines.slice(2) : tableLines.slice(1);
  if (!sepIsSep) {
    note(maybeSep?.line ?? header.line, "Roles & Permissions table needs a separator row (| --- | --- |).");
  }

  const actions: PermissionMatrix["actions"] = [];
  const seenActions = new Map<string, number>();

  for (const row of rows) {
    const actionId = row.cells[0] ?? "";
    if (!ACTION_ID.test(actionId)) {
      note(row.line, `Action id "${actionId}" must be kebab-case or PascalCase (letters, digits, hyphen).`);
    }
    const prev = seenActions.get(actionId);
    if (prev) note(row.line, `Duplicate action "${actionId}" (already at line ${prev}).`);
    else seenActions.set(actionId, row.line);

    const permissions: Record<string, Permission> = {};
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i] ?? "";
      const cell = row.cells[i + 1] ?? "";
      if (cell !== "allow" && cell !== "deny") {
        note(
          row.line,
          `Cell for ${role || "role"} / ${actionId || "action"} must be allow or deny (got "${cell || "blank"}").`,
        );
        continue;
      }
      permissions[role] = cell;
    }
    actions.push({ id: actionId, permissions, line: row.line });
  }

  return { roles, actions };
}

function splitH3(body: string[], sectionLine: number): { title: string; line: number; lines: string[] }[] {
  const blocks: { title: string; line: number; lines: string[] }[] = [];
  let current: { title: string; line: number; lines: string[] } | null = null;
  for (let i = 0; i < body.length; i++) {
    const raw = body[i] ?? "";
    const line = sectionLine + 1 + i;
    const h3 = raw.match(H3);
    if (h3) {
      current = { title: h3[1]?.trim() ?? "", line, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(raw);
  }
  return blocks;
}

function collectFields(
  lines: string[],
  startLine: number,
): Map<string, { value: string; line: number }> {
  const fields = new Map<string, { value: string; line: number }>();
  let currentKey: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = startLine + 1 + i;
    if (!raw.trim()) continue;
    const match = raw.trim().match(FIELD);
    if (match) {
      const key = (match[1] ?? "").toLowerCase();
      currentKey = key;
      fields.set(key, { value: match[2] ?? "", line });
      continue;
    }
    if (currentKey) {
      const prev = fields.get(currentKey);
      if (prev) prev.value = `${prev.value}\n${raw}`.trim();
    }
  }
  return fields;
}

function collectUseCase(
  lines: string[],
  startLine: number,
): { fields: Map<string, { value: string; line: number }>; steps: string[] } {
  const fields = new Map<string, { value: string; line: number }>();
  const steps: string[] = [];
  let currentKey: string | null = null;
  let inSteps = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = startLine + 1 + i;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const numbered = trimmed.match(NUMBERED);
    const match = trimmed.match(FIELD);

    if (match && (match[1] ?? "").toLowerCase() === "steps") {
      inSteps = true;
      currentKey = "steps";
      const rest = (match[2] ?? "").trim();
      const maybeNum = rest.match(NUMBERED);
      if (maybeNum?.[2]) steps.push(maybeNum[2]);
      continue;
    }

    if (inSteps && numbered?.[2]) {
      steps.push(numbered[2]);
      continue;
    }

    if (match) {
      inSteps = false;
      const key = (match[1] ?? "").toLowerCase();
      currentKey = key;
      fields.set(key, { value: match[2] ?? "", line });
      continue;
    }

    if (currentKey && currentKey !== "steps") {
      const prev = fields.get(currentKey);
      if (prev) prev.value = `${prev.value}\n${raw}`.trim();
    }
  }

  return { fields, steps };
}

export function buildHealth(
  requirementId: string,
  specState: Health["spec"]["state"],
  findings: Finding[],
): Health {
  const errors = findings.filter((f) => f.severity === "error");
  let nextAction: Health["nextAction"];
  let howThisIsGoing: string;

  if (specState === "empty") {
    nextAction = { id: "create", label: "Create this requirement", enabled: true };
    howThisIsGoing = "Nothing here yet. Create the pack to begin.";
  } else if (specState === "valid") {
    nextAction = {
      id: "check-jev",
      label: "Check this spec with Jev",
      enabled: true,
      hint: "Needs TYPESAFE_API_KEY.",
    };
    howThisIsGoing =
      "The pack is valid. Ready stays Not yet until a TypeSafe API key is set. Persona checks do not need a key.";
  } else {
    const first = errors[0];
    nextAction = {
      id: "fix-spec",
      label: first ? `Fix: ${truncate(first.message, 72)}` : "Finish the required sections",
      enabled: true,
    };
    howThisIsGoing =
      errors.length === 1
        ? `1 compile error. ${first?.message ?? "Keep filling the spec."}`
        : `${errors.length} compile errors. Spec is drafting, not valid.`;
  }

  return {
    requirementId,
    spec: { state: specState, findings },
    ready: emptyReady(specState === "valid" ? "unchecked" : "spec_invalid"),
    build: { state: "not_yet" },
    proof: { state: "not_yet", runtime: false, findings: [] },
    nextAction,
    howThisIsGoing,
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function healthToStatusMarkdown(health: Health): string {
  const lines = [
    `# ${health.requirementId}`,
    "",
    health.howThisIsGoing,
    "",
    `- Spec: ${health.spec.state}`,
    `- Ready: ${health.ready.state}${health.ready.reason ? ` (${health.ready.reason})` : ""}`,
    `- Build: ${health.build.state}`,
    `- Proof: ${health.proof.state}${health.proof.runtime ? "" : " (no runtime)"}`,
    `- Next: ${health.nextAction.label}${health.nextAction.enabled ? "" : " (not yet)"}`,
  ];
  if (health.ready.blockers || health.ready.nits) {
    lines.push(`- Ready blockers: ${health.ready.blockers}`, `- Ready nits: ${health.ready.nits}`);
  }
  if (health.spec.findings.length) {
    lines.push("", "## Findings");
    for (const f of health.spec.findings) {
      lines.push(`- L${f.line} ${f.severity}: ${f.message}`);
    }
  }
  if (health.ready.findings.length) {
    lines.push("", "## Ready");
    for (const f of health.ready.findings) {
      lines.push(`- ${f.severity}: ${f.message}`);
    }
  }
  if (health.proof.findings.length) {
    lines.push("", "## Proof");
    for (const f of health.proof.findings) {
      lines.push(`- ${f.severity}: ${f.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
