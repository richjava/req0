import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ImplementDisabledError, ImplementLockedError } from "./implement.js";
import { FixFromProofLockedError } from "./fix-from-proof.js";
import { StackRequiredError } from "./stack.js";
import { createMockJevClient } from "./jev.js";
import { ProveLockedError } from "./proof.js";
import { IgnoreBuildLockedError, specHash } from "./ready.js";
import { checkPack, compilePack, createPack, ignoreBuild, implementPack, improvePack, packPaths, provePack } from "./pack.js";
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
      expect(health.build.needsStack).toBe(true);
      expect(health.nextAction.enabled).toBe(false);
    } else if (health.ready.reason === "blockers") {
      expect(health.ready.blockers).toBeGreaterThan(0);
      expect(health.nextAction.label).toBe("Improve it");
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
      const runtime = await readFile(created.runtime, "utf8");
      expect(runtime).toContain("baseUrl:");
      expect(runtime).toContain("#email");
      const result = await compilePack(created);
      expect(result.health.spec.state).toBe("drafting");
      expect(result.health.proof.runtime).toBe(true);
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
      await expect(implementPack(paths, { adapter: "manual" })).rejects.toBeInstanceOf(StackRequiredError);
      const launched = await implementPack(paths, { adapter: "manual", stack: "nextjs-default" });
      expect(launched.result.health.ready.state).toBe("ready");
      expect(launched.result.health.build.state).toBe("succeeded");
      expect(launched.result.health.nextAction.id).toBe("prove");
      expect(launched.result.health.nextAction.enabled).toBe(true);
      expect(launched.result.health.proof.runtime).toBe(true);
      expect(await readFile(paths.runtime, "utf8")).toContain("baseUrl:");
      const config = await readReq0Config(parent);
      expect(config?.adapter).toBe("manual");
      expect(config?.stack?.id).toBe("nextjs-default");
      const run = JSON.parse(await readFile(paths.buildRun, "utf8"));
      expect(run.state).toBe("succeeded");
      expect(run.adapter).toBe("manual");
      await expect(implementPack(paths, { adapter: "manual", fromProof: true })).rejects.toBeInstanceOf(
        FixFromProofLockedError,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("reuses a stack already written in req0.json", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-impl-recorded-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(paths.personas, "personas:\n  Viewer:\n    email: viewer@example.test\n", "utf8");
      await writeFile(
        path.join(parent, "req0.json"),
        `${JSON.stringify({ stack: { id: "amplify-gen2", label: "Amplify Gen 2, Next.js, Cognito, Data, S3" } }, null, 2)}\n`,
        "utf8",
      );
      await checkPack(paths, createMockJevClient());
      expect(await readFile(path.join(parent, ".env.example"), "utf8")).toContain("AWS_REGION=");
      expect((await compilePack(paths)).health.build.needsStack).toBe(false);
      const launched = await implementPack(paths, { adapter: "manual" });
      expect(launched.result.health.build.state).toBe("succeeded");
      const config = await readReq0Config(parent);
      expect(config?.stack?.id).toBe("amplify-gen2");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("enables Prove after implement when runtime.yaml parses, then records a mock proof", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-prove-ok-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(paths.personas, "personas:\n  Viewer:\n    email: viewer@example.test\n    password: x\n", "utf8");
      await writeFile(
        paths.runtime,
        `baseUrl: http://127.0.0.1:3000
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: button
`,
        "utf8",
      );
      await checkPack(paths, createMockJevClient());
      const launched = await implementPack(paths, { adapter: "manual", stack: "nextjs-default" });
      expect(launched.result.health.nextAction.id).toBe("prove");
      expect(launched.result.health.nextAction.enabled).toBe(true);
      expect(launched.result.qaPlan?.cases).toHaveLength(1);
      const proved = await provePack(paths, {
        client: createMockJevClient(),
        waitForUrl: async () => true,
        driver: {
          async runCase() {
            return {
              url: "http://127.0.0.1:3000/invoices",
              text: "Invoices are listed",
              options: [],
              controlAvailable: false,
              controlDisabled: false,
              clicked: false,
            };
          },
        },
      });
      expect(proved.result.health.proof.state).toBe("passed");
      expect(proved.result.health.proof.runtime).toBe(true);
      const proveLog = await readFile(paths.proveLog, "utf8");
      expect(proveLog).toMatch(/Checking http:\/\/127.0.0.1:3000/);
      expect(proveLog).toMatch(/Proof passed/);
      const proofRun = JSON.parse(await readFile(paths.proofRun, "utf8"));
      const buildRun = JSON.parse(await readFile(paths.buildRun, "utf8"));
      expect(proofRun.buildAt).toBe(buildRun.at);
      const report = await readFile(paths.proofReport, "utf8");
      expect(report).toContain("# Proof report — demo-pack");
      expect(report).toContain("### UC-001");
      expect(report).toContain("Expected: Invoices are listed.");
      expect(report).toContain("## Passed");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("proves without a build stamp when req0.json sets implement false", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-impl-off-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(
        paths.personas,
        "personas:\n  Viewer:\n    email: viewer@example.test\n    password: x\n",
        "utf8",
      );
      await writeFile(
        paths.runtime,
        `baseUrl: http://127.0.0.1:3000
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: button
`,
        "utf8",
      );
      await writeFile(path.join(parent, "req0.json"), `${JSON.stringify({ implement: false }, null, 2)}\n`, "utf8");
      await checkPack(paths, createMockJevClient());
      const compiled = await compilePack(paths);
      expect(compiled.health.build.owned).toBe(false);
      expect(compiled.health.stages?.build.hidden).toBe(true);
      expect(compiled.health.nextAction.id).toBe("prove");
      expect(compiled.health.nextAction.enabled).toBe(true);
      await expect(implementPack(paths, { adapter: "manual" })).rejects.toBeInstanceOf(ImplementDisabledError);
      await expect(readFile(paths.buildRun, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const proved = await provePack(paths, {
        client: createMockJevClient(),
        waitForUrl: async () => true,
        driver: {
          async runCase() {
            return {
              url: "http://127.0.0.1:3000/invoices",
              text: "Invoices are listed",
              options: [],
              controlAvailable: false,
              controlDisabled: false,
              clicked: false,
            };
          },
        },
      });
      expect(proved.result.health.proof.state).toBe("passed");
      const proofRun = JSON.parse(await readFile(paths.proofRun, "utf8"));
      expect(proofRun.buildAt).toBeUndefined();
      expect(await readFile(paths.proofReport, "utf8")).toContain("Result: **Passed");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("unlocks Prove after Ignore on a failed Build", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-ignore-build-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(
        paths.personas,
        "personas:\n  Viewer:\n    email: viewer@example.test\n    password: x\n",
        "utf8",
      );
      await writeFile(
        paths.runtime,
        `baseUrl: http://127.0.0.1:3000
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: button
`,
        "utf8",
      );
      await checkPack(paths, createMockJevClient());
      await implementPack(paths, { adapter: "manual", stack: "nextjs-default" });
      const compiled = await compilePack(paths);
      await writeFile(
        paths.buildRun,
        `${JSON.stringify(
          {
            specHash: specHash(compiled.spec!),
            state: "failed",
            adapter: "cursor",
            at: "2026-01-01T00:00:00.000Z",
            message: "Implement was interrupted.",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const locked = await compilePack(paths);
      expect(locked.health.build.state).toBe("failed");
      expect(locked.health.stages?.proof.enabled).toBe(false);
      expect(locked.health.stages?.ignoreBuild).toMatchObject({ id: "ignore-build", enabled: true });
      await expect(
        provePack(paths, { client: createMockJevClient(), waitForUrl: async () => true }),
      ).rejects.toBeInstanceOf(ProveLockedError);

      const keptFailed = await ignoreBuild(paths, false);
      expect(keptFailed.result.health.build.state).toBe("failed");
      expect(keptFailed.result.health.build.ignored).toBe(true);
      expect(keptFailed.result.health.stages?.proof.enabled).toBe(true);
      expect(keptFailed.result.health.stages?.ignoreBuild).toBeUndefined();
      const proved = await provePack(paths, {
        client: createMockJevClient(),
        waitForUrl: async () => true,
        driver: {
          async runCase() {
            return {
              url: "http://127.0.0.1:3000/invoices",
              text: "Invoices are listed",
              options: [],
              controlAvailable: false,
              controlDisabled: false,
              clicked: false,
            };
          },
        },
      });
      expect(proved.result.health.proof.state).toBe("passed");

      await writeFile(
        paths.buildRun,
        `${JSON.stringify(
          {
            specHash: specHash(compiled.spec!),
            state: "failed",
            adapter: "cursor",
            at: "2026-01-02T00:00:00.000Z",
            message: "Implement was interrupted.",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const marked = await ignoreBuild(paths, true);
      expect(marked.result.health.build.state).toBe("succeeded");
      expect(marked.result.health.build.ignored).toBe(true);
      expect(marked.result.health.stages?.proof.enabled).toBe(true);
      await expect(ignoreBuild(paths, true)).rejects.toBeInstanceOf(IgnoreBuildLockedError);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("writes an improve brief without recording a build run", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-improve-"));
    const root = path.join(parent, "docs/requirements/demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(paths.requirement, READY_MD, "utf8");
      await writeFile(paths.personas, "personas:\n", "utf8");
      const compiled = await compilePack(paths);
      expect(compiled.health.ready.findings.some((finding) => finding.kind === "persona_missing")).toBe(true);
      const improved = await improvePack(paths, { adapter: "manual" });
      expect(improved.brief).toContain("Viewer");
      expect(improved.brief).toContain("<role-slug>@example.test");
      expect(improved.brief).toContain("test-only-not-production");
      expect(improved.brief).toContain("Opinionated writer pass");
      const brief = await readFile(paths.improveBrief, "utf8");
      expect(brief).toContain("persona_missing");
      const snap = JSON.parse(await readFile(paths.improveSnapshot, "utf8")) as {
        files: { relative: string; content: string | null }[];
      };
      expect(snap.files.some((file) => file.relative === "requirement.md" && file.content?.includes("Invoice"))).toBe(
        true,
      );
      await expect(readFile(paths.buildRun, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
