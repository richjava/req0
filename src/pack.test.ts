import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ImplementLockedError } from "./implement.js";
import { createMockJevClient } from "./jev.js";
import { checkPack, compilePack, createPack, implementPack, packPaths } from "./pack.js";
import { readReq0Config } from "./stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("pack compile", () => {
  it("writes derived health for the golden pack", async () => {
    const result = await compilePack(
      packPaths(path.join(repoRoot, "docs/requirements/invoice-approval")),
    );
    expect(result.health.spec.state).toBe("valid");
    expect(result.jevPack?.catalog).toBe("m2-authoring-v1");
    expect(result.jevPack?.questions.some((q) => q.id === "rule.observable.BR-001")).toBe(true);
    const health = JSON.parse(
      await readFile(path.join(repoRoot, "docs/requirements/invoice-approval/derived/health.json"), "utf8"),
    );
    expect(health.spec.state).toBe("valid");
    if (health.ready.state === "ready") {
      expect(health.ready.blockers).toBe(0);
      expect(health.nextAction.id).toBe("implement");
      expect(health.nextAction.enabled).toBe(true);
    } else if (health.ready.reason === "blockers") {
      expect(health.ready.blockers).toBeGreaterThan(0);
      expect(health.nextAction.label).toMatch(/^Improve /);
    } else {
      expect(health.ready.state).toBe("not_yet");
      expect(["no_api_key", "unchecked"]).toContain(health.ready.reason);
      expect(health.ready.findings).toEqual([]);
    }
    const jevPack = JSON.parse(
      await readFile(path.join(repoRoot, "docs/requirements/invoice-approval/derived/jev-pack.json"), "utf8"),
    );
    expect(jevPack.questions.length).toBeGreaterThan(8);
    const brief = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/derived/implement-brief.md"),
      "utf8",
    );
    expect(brief).toContain("BR-001");
    expect(brief).toContain("This product repo is empty");
  });

  it("creates a drafting pack from a kebab folder", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-"));
    const root = path.join(parent, "temp-pack");
    try {
      const created = await createPack(root);
      const markdown = await readFile(created.requirement, "utf8");
      expect(markdown).toContain("## Business Rules");
      const result = await compilePack(created);
      expect(result.health.spec.state).toBe("drafting");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

const READY_MD = `# Demo

## Business Rules

### A
Id: BR-001
Statement: Viewers can view invoices.
Observable: The invoice list is visible while logged in as a viewer.

## Use Cases

### B
Id: UC-001
Actor: Viewer
Preconditions: The viewer is logged in.
Steps:
1. Open invoices
Outcome: Invoices are listed.

## Roles & Permissions

| Action | Viewer |
| --- | --- |
| view-invoice | allow |
`;

describe("implementPack", () => {
  it("refuses until Ready is Ready", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-impl-locked-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(paths.personas, "personas:\n  Viewer:\n    email: viewer@example.test\n", "utf8");
      await expect(implementPack(paths, { adapter: "manual" })).rejects.toBeInstanceOf(ImplementLockedError);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("records the default stack and succeeds with the manual adapter", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-impl-ok-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(paths.personas, "personas:\n  Viewer:\n    email: viewer@example.test\n", "utf8");
      await checkPack(paths, createMockJevClient());
      const launched = await implementPack(paths, { adapter: "manual" });
      expect(launched.result.health.ready.state).toBe("ready");
      expect(launched.result.health.build.state).toBe("succeeded");
      expect(launched.result.health.nextAction.id).toBe("prove");
      expect(launched.result.health.nextAction.enabled).toBe(false);
      const config = await readReq0Config(parent);
      expect(config?.adapter).toBe("manual");
      expect(config?.stack?.id).toBe("nextjs-default");
      const run = JSON.parse(await readFile(paths.buildRun, "utf8"));
      expect(run.state).toBe("succeeded");
      expect(run.adapter).toBe("manual");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
