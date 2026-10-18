import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAnswers } from "./agent-questions.js";
import {
  appendDecisionsSection,
  appendPlanDecisions,
  emitImplementPlanBrief,
  formatPlanDecisionsRound,
  parseImplementPlanState,
  planIsStale,
  snapshotAcceptedPlan,
  snapshotPlanFilename,
} from "./implement-plan.js";
import type { SpecAst } from "./types.js";

const spec: SpecAst = {
  requirementId: "demo",
  title: "Demo",
  optional: {},
  businessRules: [{ id: "BR-001", title: "A", statement: "s", observable: "o", line: 1 }],
  useCases: [
    {
      id: "UC-001",
      title: "B",
      actor: "Viewer",
      preconditions: "p",
      steps: ["Open list"],
      outcome: "Listed",
      line: 2,
    },
  ],
  matrix: { roles: ["Viewer"], actions: [{ id: "view", permissions: { Viewer: "allow" }, line: 3 }] },
};

const openRound = {
  version: 1 as const,
  channel: "plan" as const,
  status: "open" as const,
  at: "2026-10-18T09:02:00.000Z",
  questions: [
    {
      id: "q1",
      prompt: "Keep Invoice.department as a field on Invoice?",
      kind: "choice" as const,
      options: [
        { id: "keep", label: "Keep on Invoice (recommended)" },
        { id: "split", label: "Split to Department" },
      ],
      required: true,
      allowCustom: true,
    },
  ],
};

describe("implement plan helpers", () => {
  it("emits a planner brief that names the system map and plan channel", () => {
    const brief = emitImplementPlanBrief({
      spec,
      system: { path: "docs/system.md", text: "", exists: false },
    });
    expect(brief).toContain("docs/system.md");
    expect(brief).toContain("channel\": \"plan\"");
    expect(brief).toContain("Do not write product code");
    expect(brief).toContain("Schema delta");
  });

  it("appends a closed Q&A round under Decisions", () => {
    const answered = applyAnswers(openRound, { q1: "keep" });
    const next = appendDecisionsSection("# Implement plan\n\n## Intent\n\nLand UC-001.\n", formatPlanDecisionsRound(answered));
    expect(next).toContain("## Decisions");
    expect(next).toContain("Keep on Invoice");
    expect(next).toContain("## Intent");
  });

  it("snapshots only the working markdown to derived/plans", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-plan-snap-"));
    const derived = path.join(dir, "derived");
    try {
      await mkdir(derived, { recursive: true });
      const paths = {
        derived,
        implementPlan: path.join(derived, "implement-plan.md"),
        implementPlanState: path.join(derived, "implement-plan.json"),
        implementPlanBrief: path.join(derived, "implement-plan-brief.md"),
        implementPlans: path.join(derived, "plans"),
      };
      await writeFile(paths.implementPlan, "# Implement plan\n\nAccepted.\n", "utf8");
      const at = new Date("2026-10-18T09:02:00.000Z");
      const rel = await snapshotAcceptedPlan(paths, at);
      expect(rel).toBe(`derived/plans/${snapshotPlanFilename(at)}`);
      expect(await readFile(path.join(dir, rel), "utf8")).toContain("Accepted");
      await appendPlanDecisions(paths, applyAnswers(openRound, { q1: "__skip__" }));
      const working = await readFile(paths.implementPlan, "utf8");
      expect(working).toContain("skipped");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a specHash mismatch as stale", () => {
    expect(
      planIsStale(
        { version: 1, specHash: "aaa", status: "accepted", at: "2026-01-01T00:00:00.000Z" },
        "bbb",
      ),
    ).toBe(true);
    expect(parseImplementPlanState({ version: 1, specHash: "x", status: "running", at: "t" })?.status).toBe("running");
  });
});
