import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockJevClient, createTypeSafeJevClient, JevRequestError, JevUnavailableError, resolveJevClient } from "./jev.js";
import { emitJevPack } from "./jev-pack.js";
import { checkPack, compilePack, packPaths } from "./pack.js";
import type { SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "demo",
  title: "Demo",
  optional: {},
  businessRules: [
    { id: "BR-001", title: "A", statement: "s", observable: "o", line: 1 },
  ],
  useCases: [
    {
      id: "UC-001",
      title: "B",
      actor: "Viewer",
      preconditions: "p",
      steps: ["Do"],
      outcome: "o",
      line: 2,
    },
  ],
  matrix: {
    roles: ["Viewer"],
    actions: [{ id: "view-invoice", permissions: { Viewer: "allow" }, line: 3 }],
  },
};

describe("Jev client", () => {
  const previous = {
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    REQ0_JEV: process.env.REQ0_JEV,
  };

  afterEach(() => {
    for (const key of ["TYPESAFE_API_KEY", "REQ0_JEV"] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("fails closed without a key", async () => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.REQ0_JEV;
    await expect(resolveJevClient().judge(emitJevPack(spec))).rejects.toBeInstanceOf(JevUnavailableError);
  });

  it("mock client returns passing answers for the frozen catalog", async () => {
    const answers = await createMockJevClient().judge(emitJevPack(spec));
    expect(answers.find((a) => a.id === "rule.observable.BR-001")?.noul).toBeGreaterThan(0.85);
    expect(answers.find((a) => a.id === "usecase.contradicts.UC-001")?.noul).toBeLessThan(0.15);
  });

  it("TypeSafe client posts the System One body", async () => {
    let body: unknown;
    const client = createTypeSafeJevClient("test-key", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            "rule.observable.BR-001": { noul: 0.9, confidence: 0.8 },
            "usecase.contradicts.UC-001": { noul: 0.05, confidence: 0.8 },
            "section.score.business-rules": { score: 2, confidence: 0.8 },
            "section.score.use-cases": { score: 2, confidence: 0.8 },
            "section.score.roles-permissions": { score: 2, confidence: 0.8 },
            "pack.next-id": { choice: "BR-001", confidence: 0.8 },
            "pack.agent-ready": { noul: 0.9, confidence: 0.8 },
          },
        }),
        { status: 200 },
      );
    });
    const answers = await client.judge(emitJevPack(spec));
    const sent = body as { model: string; questions: Record<string, { type: string }> };
    expect(sent.model).toBe("jev-latest");
    expect(sent.questions["rule.observable.BR-001"]?.type).toBe("noul");
    expect(answers.find((a) => a.id === "pack.agent-ready")?.noul).toBe(0.9);
  });

  it("throws JevRequestError on non-JSON TypeSafe bodies", async () => {
    const client = createTypeSafeJevClient("test-key", async () => new Response("<html>nope</html>", { status: 502 }));
    await expect(client.judge(emitJevPack(spec))).rejects.toBeInstanceOf(JevRequestError);
  });
});

describe("checkPack", () => {
  it("uses the mock client to mark a complete pack Ready", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-ready-"));
    const root = path.join(parent, "demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(
        paths.requirement,
        `# Demo

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
`,
        "utf8",
      );
      await writeFile(
        paths.personas,
        `personas:
  Viewer:
    email: viewer@example.test
`,
        "utf8",
      );
      await compilePack(paths);
      const result = await checkPack(paths, createMockJevClient());
      expect(result.health.ready.state).toBe("ready");
      expect(result.health.nextAction.id).toBe("implement");
      expect(result.health.nextAction.enabled).toBe(true);
      expect(result.health.nextAction.hint).toContain("Cursor");
      expect(result.implementBrief).toContain("BR-001");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("does not invent Jev scores when the client is unavailable", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-nokey-"));
    const root = path.join(parent, "demo-pack");
    try {
      const paths = packPaths(root);
      await mkdir(path.join(root, "fixtures"), { recursive: true });
      await writeFile(
        paths.requirement,
        `# Demo

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
`,
        "utf8",
      );
      await writeFile(
        paths.personas,
        `personas:
  Viewer:
    email: viewer@example.test
`,
        "utf8",
      );
      const result = await checkPack(paths, {
        async judge() {
          throw new JevUnavailableError();
        },
      });
      expect(result.health.spec.state).toBe("valid");
      expect(result.health.ready.state).toBe("not_yet");
      expect(result.health.ready.reason).toBe("no_api_key");
      expect(result.health.ready.findings).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
