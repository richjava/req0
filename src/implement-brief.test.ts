import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile.js";
import { emitImplementBrief } from "./implement-brief.js";
import { parsePersonasYaml } from "./personas.js";
import { AMPLIFY_GEN2_STACK, DEFAULT_STACK } from "./stack.js";

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
      repo: { root: repoRoot, empty: true, stack: DEFAULT_STACK, recorded: false, adapter: "manual", implement: true },
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
    expect(brief).toContain("## Pack files");
    expect(brief).toContain("## Product README");
    expect(brief).toContain("README.md");
    expect(brief).toContain("docs/requirements/invoice-approval/fixtures/personas.yaml");
    expect(brief).toContain("fixtures/runtime.yaml");
    expect(brief).toContain("amplify-gen2");
    expect(brief).not.toContain("## AWS");
    expect(brief).not.toContain("test-only-not-production");
  });

  it("adds an AWS section only for the amplify-gen2 stack", async () => {
    const markdown = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/requirement.md"),
      "utf8",
    );
    const spec = compileMarkdown("invoice-approval", markdown).spec;
    const brief = emitImplementBrief({
      spec: spec!,
      repo: {
        root: repoRoot,
        empty: true,
        stack: AMPLIFY_GEN2_STACK,
        recorded: true,
        adapter: "manual",
        implement: true,
      },
      adapter: "manual",
    });
    expect(brief).toContain("## AWS");
    expect(brief).toContain("Cognito");
    expect(brief).toContain("npx ampx sandbox --once");
    expect(brief).toContain("REPLACE_VIA_SANDBOX");
    expect(brief).toContain("does not read `.env`");
    expect(brief).toContain("npx ampx configure profile");
    expect(brief).toContain("tsx@4.19.4");
    expect(brief).toContain("fileURLToPath(import.meta.url)");
    expect(brief).toContain("Do not print env values");
    expect(brief).toContain("npm run sandbox");
    expect(brief).toContain("# Invoice approval");
    expect(brief).not.toContain("Invoice Desk");
    expect(brief).not.toContain("already in the product");
    expect(brief).not.toContain("AKIA");
  });
});
