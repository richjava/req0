import { describe, expect, it } from "vitest";
import { pipelineView, sectionCatalog } from "./stages.js";
import type { Health } from "./types.js";

function health(partial: Partial<Health> = {}): Health {
  return {
    requirementId: "demo",
    spec: { state: "valid", findings: [] },
    ready: {
      state: "ready",
      reason: "passed",
      blockers: 0,
      nits: 0,
      findings: [],
      jevCurrent: true,
      packNoul: 0.91,
    },
    build: { state: "not_yet" },
    proof: { state: "not_yet", runtime: true, findings: [] },
    nextAction: { id: "implement", label: "Implement", enabled: true },
    howThisIsGoing: "",
    ...partial,
  };
}

describe("pipelineView", () => {
  it("skips Implement when the stage is not owned", () => {
    const view = pipelineView(health({ build: { state: "not_yet", owned: false } }), true);
    expect(view.implementOwned).toBe(false);
    expect(view.nodes.find((node) => node.id === "implement")?.hidden).toBe(true);
    expect(view.nodes.map((node) => node.id)).toEqual(["start", "define", "implement", "qa", "end"]);
  });

  it("marks End ok only after QA passed", () => {
    const before = pipelineView(health(), true);
    expect(before.nodes.find((node) => node.id === "end")?.tone).toBe("idle");
    const after = pipelineView(
      health({ proof: { state: "passed", runtime: true, findings: [] } }),
      true,
    );
    expect(after.nodes.find((node) => node.id === "end")?.tone).toBe("ok");
    expect(after.nodes.find((node) => node.id === "qa")?.badge).toBe("Passed");
  });

  it("uses Clear on Define when Judgment passed", () => {
    const view = pipelineView(health(), true);
    expect(view.nodes.find((node) => node.id === "define")?.badge).toBe("Clear · 0.91");
    expect(view.nodes.find((node) => node.id === "define")?.tone).toBe("ok");
  });

  it("hangs Spec and Judgment under Define", () => {
    const view = pipelineView(health(), true);
    const children = view.nodes.find((node) => node.id === "define")?.children ?? [];
    expect(children.map((child) => child.id)).toEqual(["spec", "judgment"]);
    expect(children[0]?.badge).toBe("Valid");
    expect(children[1]?.badge).toBe("Clear · 0.91");
  });
});

describe("sectionCatalog", () => {
  it("lists required then optional headings", () => {
    const names = sectionCatalog().map((section) => section.name);
    expect(names.slice(0, 3)).toEqual(["Business Rules", "Use Cases", "Roles & Permissions"]);
    expect(names).toContain("Overview");
  });
});
