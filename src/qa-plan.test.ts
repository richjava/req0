import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile.js";
import { caseKind, controlName, emitQaPlan } from "./qa-plan.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("emitQaPlan", () => {
  it("compiles one case per use case from the golden spec", async () => {
    const markdown = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/requirement.md"),
      "utf8",
    );
    const compiled = compileMarkdown("invoice-approval", markdown);
    expect(compiled.spec).not.toBeNull();
    const plan = emitQaPlan(compiled.spec!);
    expect(plan.cases.map((item) => item.id)).toEqual([
      "UC-001",
      "UC-002",
      "UC-003",
      "UC-004",
      "UC-005",
    ]);
    expect(plan.cases[0]).toMatchObject({ kind: "allow", actor: "Manager", control: "Approve" });
    expect(plan.cases[1]).toMatchObject({ kind: "deny", actor: "Viewer", control: "Approve" });
    expect(plan.cases[2]).toMatchObject({
      kind: "allow",
      actor: "Admin",
      control: "Assign approver",
    });
    expect(plan.cases[3]?.kind).toBe("deny");
    expect(plan.cases[4]?.kind).toBe("deny");
  });

  it("treats Look-for steps as deny and Choose as the control", () => {
    expect(
      caseKind({
        id: "UC-002",
        title: "t",
        actor: "Viewer",
        preconditions: "p",
        steps: ["Look for Approve"],
        outcome: "Approve is not available",
        line: 1,
      }),
    ).toBe("deny");
    expect(
      controlName({
        id: "UC-003",
        title: "t",
        actor: "Admin",
        preconditions: "p",
        steps: ["Choose Assign approver", "Select the Finance manager"],
        outcome: "Assigned",
        line: 1,
      }),
    ).toBe("Assign approver");
  });
});
