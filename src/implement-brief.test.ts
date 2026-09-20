import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile.js";
import { emitImplementBrief } from "./implement-brief.js";
import { parsePersonasYaml } from "./personas.js";
import { DEFAULT_STACK } from "./stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("emitImplementBrief", () => {
  it("writes a portable brief for the golden pack", async () => {
    const markdown = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/requirement.md"),
      "utf8",
    );
    const spec = compileMarkdown("invoice-approval", markdown).spec;
    expect(spec).not.toBeNull();
    const personas = parsePersonasYaml(
      await readFile(path.join(repoRoot, "docs/requirements/invoice-approval/fixtures/personas.yaml"), "utf8"),
    );
    const brief = emitImplementBrief({
      spec: spec!,
      repo: { root: repoRoot, empty: true, stack: DEFAULT_STACK, recorded: false, adapter: "manual" },
      adapter: "manual",
      personas,
    });
    expect(brief).toContain("BR-001");
    expect(brief).toContain("UC-002");
    expect(brief).toContain("approve-invoice");
    expect(brief).toContain("Viewer: viewer@example.test");
    expect(brief).toContain(DEFAULT_STACK.label);
    expect(brief).toContain("This product repo is empty");
    expect(brief).toContain("Build Succeeded");
    expect(brief).not.toContain("test-only-not-production");
  });
});
