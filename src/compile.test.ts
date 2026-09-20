import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile.js";
import { EMPTY_TEMPLATE } from "./template.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("compileMarkdown", () => {
  it("compiles the golden invoice-approval pack", async () => {
    const markdown = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/requirement.md"),
      "utf8",
    );
    const result = compileMarkdown("invoice-approval", markdown);
    expect(result.health.spec.findings).toEqual([]);
    expect(result.health.spec.state).toBe("valid");
    expect(result.health.ready.state).toBe("not_yet");
    expect(result.health.build.state).toBe("not_yet");
    expect(result.health.proof.state).toBe("not_yet");
    expect(result.health.nextAction.id).toBe("check-jev");
    expect(result.health.nextAction.enabled).toBe(true);
    expect(result.health.ready.reason).toBe("unchecked");
    expect(result.spec?.businessRules.map((r) => r.id)).toEqual([
      "BR-001",
      "BR-002",
      "BR-003",
      "BR-004",
      "BR-005",
    ]);
    expect(result.spec?.useCases.map((u) => u.id)).toEqual([
      "UC-001",
      "UC-002",
      "UC-003",
      "UC-004",
      "UC-005",
    ]);
    expect(result.spec?.optional.Entities).toContain("Finance");
    expect(result.spec?.matrix.actions.map((a) => a.id)).toEqual([
      "view-invoice",
      "assign-approver",
      "approve-invoice",
    ]);
    expect(result.spec?.matrix.roles).toEqual(["Admin", "Manager", "Viewer"]);
    expect(result.spec?.matrix.actions.find((a) => a.id === "approve-invoice")?.permissions).toEqual({
      Admin: "deny",
      Manager: "allow",
      Viewer: "deny",
    });
    expect(result.spec?.useCases[1]?.steps).toEqual([
      "Open the unpaid invoices list",
      "Open the invoice",
      "Look for Approve",
    ]);
  });

  it("reports unknown h2 with a line number", () => {
    const result = compileMarkdown(
      "invoice-approval",
      `# Title

## Business Rules

### A
Id: BR-001
Statement: s
Observable: o

## Use Cases

### B
Id: UC-001
Actor: Viewer
Preconditions: p
Steps:
1. Do the thing
Outcome: o

## Roles & Permissions

| Action | Viewer |
| --- | --- |
| view-invoice | allow |

## Mystery
`,
    );
    const hit = result.health.spec.findings.find((f) => f.message.includes("Mystery"));
    expect(hit?.line).toBe(26);
    expect(result.health.spec.state).not.toBe("valid");
  });

  it("rejects actor that is not a matrix role", () => {
    const result = compileMarkdown(
      "x",
      `# Title

## Business Rules

### A
Id: BR-001
Statement: s
Observable: o

## Use Cases

### B
Id: UC-001
Actor: Ghost
Preconditions: p
Steps:
1. Do the thing
Outcome: o

## Roles & Permissions

| Action | Viewer |
| --- | --- |
| view-invoice | allow |
`,
    );
    expect(result.health.spec.findings.some((f) => f.message.includes('Ghost'))).toBe(true);
  });

  it("rejects blank and maybe matrix cells", () => {
    const result = compileMarkdown(
      "x",
      `# Title

## Business Rules

### A
Id: BR-001
Statement: s
Observable: o

## Use Cases

### B
Id: UC-001
Actor: Viewer
Preconditions: p
Steps:
1. Do the thing
Outcome: o

## Roles & Permissions

| Action | Viewer |
| --- | --- |
| view-invoice | maybe |
`,
    );
    expect(result.health.spec.findings.some((f) => f.message.includes("allow or deny"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const result = compileMarkdown(
      "x",
      `# Title

## Business Rules

### A
Id: BR-001
Statement: s
Observable: o

### B
Id: BR-001
Statement: s
Observable: o

## Use Cases

### C
Id: UC-001
Actor: Viewer
Preconditions: p
Steps:
1. Do the thing
Outcome: o

## Roles & Permissions

| Action | Viewer |
| --- | --- |
| view-invoice | allow |
`,
    );
    expect(result.health.spec.findings.some((f) => f.message.includes("Duplicate id BR-001"))).toBe(true);
  });

  it("treats the empty template as drafting, not valid", () => {
    const result = compileMarkdown("new-thing", EMPTY_TEMPLATE);
    expect(result.health.spec.state).toBe("drafting");
    expect(result.spec).toBeNull();
    expect(result.health.nextAction.id).toBe("fix-spec");
  });

  it("treats missing file content as empty", () => {
    const result = compileMarkdown("new-thing", "");
    expect(result.health.spec.state).toBe("empty");
    expect(result.health.nextAction.id).toBe("create");
  });

  it("rejects a bad folder id", () => {
    const result = compileMarkdown("Not_Good", "# T\n");
    expect(result.health.spec.findings.some((f) => f.message.includes("kebab-case"))).toBe(true);
  });
});
