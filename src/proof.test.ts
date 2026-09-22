import { describe, expect, it } from "vitest";
import { createMockJevClient } from "./jev.js";
import { parsePersonasYaml } from "./personas.js";
import { emptyProof, evaluateProof, provePlan } from "./proof.js";
import { specHash } from "./ready.js";
import type { QaPlan } from "./types.js";
import type { SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "invoice-approval",
  title: "Invoice approval",
  optional: {},
  businessRules: [
    { id: "BR-001", title: "A", statement: "s", observable: "o", line: 1 },
  ],
  useCases: [
    {
      id: "UC-001",
      title: "Allow",
      actor: "Manager",
      preconditions: "Logged in",
      steps: ["Choose Approve"],
      outcome: "Approved",
      line: 2,
    },
    {
      id: "UC-002",
      title: "Deny",
      actor: "Viewer",
      preconditions: "Logged in",
      steps: ["Look for Approve"],
      outcome: "Approve is not available",
      line: 3,
    },
  ],
  matrix: {
    roles: ["Manager", "Viewer"],
    actions: [
      { id: "approve-invoice", permissions: { Manager: "allow", Viewer: "deny" }, line: 4 },
    ],
  },
};

const plan: QaPlan = {
  requirementId: "invoice-approval",
  specHash: specHash(spec),
  cases: [
    {
      id: "UC-001",
      specId: "UC-001",
      kind: "allow",
      actor: "Manager",
      control: "Approve",
      steps: ["Choose Approve"],
      preconditions: "Logged in",
      outcome: "Approved",
    },
    {
      id: "UC-002",
      specId: "UC-002",
      kind: "deny",
      actor: "Viewer",
      control: "Approve",
      steps: ["Look for Approve"],
      preconditions: "Logged in",
      outcome: "Approve is not available",
    },
  ],
};

const personas = parsePersonasYaml(`personas:
  Manager:
    email: manager@example.test
    password: test-only-not-production
  Viewer:
    email: viewer@example.test
    password: test-only-not-production
`);

const runtime = {
  baseUrl: "http://127.0.0.1:3000",
  login: { path: "/login", email: "#email", password: "#password", submit: "button" },
};

describe("evaluateProof", () => {
  it("stays Not yet without runtime", () => {
    expect(evaluateProof({ spec, runtime: false, run: null })).toEqual(emptyProof(false));
  });

  it("marks a hash mismatch stale", () => {
    const proof = evaluateProof({
      spec,
      runtime: true,
      run: {
        specHash: "other",
        checkedAt: "2026-01-01T00:00:00.000Z",
        boot: { ok: true },
        cases: [],
      },
    });
    expect(proof.state).toBe("stale");
    expect(proof.runtime).toBe(true);
  });

  it("fails when boot fails", () => {
    const proof = evaluateProof({
      spec,
      runtime: true,
      run: {
        specHash: specHash(spec),
        checkedAt: "2026-01-01T00:00:00.000Z",
        boot: { ok: false, message: "down" },
        cases: [],
      },
    });
    expect(proof.state).toBe("failed");
    expect(proof.findings[0]?.message).toBe("down");
  });
});

describe("provePlan", () => {
  it("passes deny when the control is absent and allow when Jev noul is high", async () => {
    const run = await provePlan(
      {
        spec,
        plan,
        runtime,
        personas,
        productRoot: "/tmp",
      },
      {
        waitForUrl: async () => true,
        client: createMockJevClient(),
        driver: {
          async runCase({ qa }) {
            if (qa.kind === "deny") {
              return {
                url: "http://127.0.0.1:3000/invoices/1",
                text: "Invoice INV-FIN-001 Status Unpaid",
                options: [],
                controlAvailable: false,
                controlDisabled: false,
                clicked: false,
              };
            }
            return {
              url: "http://127.0.0.1:3000/invoices/1",
              text: "Invoice INV-FIN-001 Status Approved",
              options: [],
              controlAvailable: true,
              controlDisabled: false,
              clicked: true,
            };
          },
        },
      },
    );
    expect(run.boot.ok).toBe(true);
    expect(run.cases).toHaveLength(2);
    expect(run.cases[0]?.verdict).toBe("pass");
    expect(run.cases[1]?.verdict).toBe("pass");
    expect(evaluateProof({ spec, runtime: true, run }).state).toBe("passed");
  });

  it("reports progress for boot, each case, and the verdict", async () => {
    const progress: string[] = [];
    await provePlan(
      {
        spec,
        plan,
        runtime,
        personas,
        productRoot: "/tmp",
      },
      {
        waitForUrl: async () => true,
        client: createMockJevClient(),
        onProgress: (message) => progress.push(message),
        driver: {
          async runCase({ qa }) {
            return {
              url: "http://127.0.0.1:3000/invoices/1",
              text: qa.kind === "deny" ? "Invoice" : "Status Approved",
              options: [],
              controlAvailable: qa.kind !== "deny",
              controlDisabled: false,
              clicked: qa.kind !== "deny",
            };
          },
        },
      },
    );
    expect(progress.some((line) => /Checking http:\/\/127.0.0.1:3000/.test(line))).toBe(true);
    expect(progress.some((line) => /Case 1\/2 — UC-001/.test(line))).toBe(true);
    expect(progress.some((line) => /Logging in as manager@example.test/.test(line))).toBe(true);
    expect(progress.some((line) => /Asking Jev whether UC-001/.test(line))).toBe(true);
    expect(progress.some((line) => /UC-001 outcome matched/.test(line))).toBe(true);
    expect(progress.some((line) => /Case 2\/2 — UC-002/.test(line))).toBe(true);
  });

  it("fails a deny case when the control is enabled", async () => {
    const run = await provePlan(
      {
        spec,
        plan,
        runtime,
        personas,
        productRoot: "/tmp",
      },
      {
        waitForUrl: async () => true,
        client: createMockJevClient(),
        driver: {
          async runCase() {
            return {
              url: "http://127.0.0.1:3000/invoices/1",
              text: "Approve",
              options: [],
              controlAvailable: true,
              controlDisabled: false,
              clicked: false,
            };
          },
        },
      },
    );
    expect(run.cases.find((item) => item.id === "UC-002")?.verdict).toBe("fail");
    expect(evaluateProof({ spec, runtime: true, run }).state).toBe("failed");
  });

  it("fails closed when baseUrl is down and there is no startCommand", async () => {
    const run = await provePlan(
      {
        spec,
        plan,
        runtime,
        personas,
        productRoot: "/tmp",
      },
      { waitForUrl: async () => false },
    );
    expect(run.boot.ok).toBe(false);
    expect(run.cases).toEqual([]);
    expect(evaluateProof({ spec, runtime: true, run }).state).toBe("failed");
  });

  it("runs resetCommand before each case", async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    await provePlan(
      {
        spec,
        plan,
        runtime: { ...runtime, resetCommand: "npm run db:seed" },
        personas,
        productRoot: "/tmp/product",
      },
      {
        waitForUrl: async () => true,
        onProgress: (message) => progress.push(message),
        runReset: async (command, cwd) => {
          calls.push(`${command} @ ${cwd}`);
        },
        client: createMockJevClient(),
        driver: {
          async runCase({ qa }) {
            return {
              url: "http://127.0.0.1:3000/invoices/1",
              text: qa.kind === "deny" ? "Invoice" : "Status Approved",
              options: [],
              controlAvailable: qa.kind !== "deny",
              controlDisabled: false,
              clicked: qa.kind !== "deny",
            };
          },
        },
      },
    );
    expect(calls).toEqual([
      "npm run db:seed @ /tmp/product",
      "npm run db:seed @ /tmp/product",
    ]);
    expect(progress.some((line) => /Resetting fixtures for UC-001/.test(line))).toBe(true);
    expect(progress.some((line) => /Resetting fixtures for UC-002/.test(line))).toBe(true);
  });

  it("fails boot when something else is answering on baseUrl without the login page", async () => {
    const progress: string[] = [];
    const run = await provePlan(
      {
        spec,
        plan,
        runtime,
        personas,
        productRoot: "/tmp",
      },
      {
        waitForUrl: async () => true,
        inspectLogin: true,
        onProgress: (message) => progress.push(message),
        fetchImpl: (async (url) => {
          if (String(url).includes("/login")) {
            return new Response(JSON.stringify({ message: "Route GET:/login not found" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("ok", { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(run.boot.ok).toBe(false);
    expect(run.boot.message).toMatch(/not this product's login page/);
    expect(run.cases).toEqual([]);
    expect(progress.some((line) => /Checking login/.test(line))).toBe(true);
  });
});
