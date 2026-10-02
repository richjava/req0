import { describe, expect, it } from "vitest";
import {
  applyAuthorGate,
  authorQualityMet,
  authorQualityTarget,
  AUTHOR_MAX_ROUNDS,
  emitAuthorBrief,
  nextAuthorStep,
  parseAuthorRun,
  seedAuthorMarkdown,
  shouldOfferAuthor,
  summarizeRequirementMarkdown,
  sanitizeArtifactFilename,
  decodeArtifactData,
  AuthorArtifactError,
  type AuthorRun,
} from "./author.js";
import type { Health } from "./types.js";

const drafting: Pick<Health, "spec"> = { spec: { state: "drafting", findings: [] } };
const validReady: Pick<Health, "spec" | "ready"> = {
  spec: { state: "valid", findings: [] },
  ready: {
    state: "ready",
    reason: "passed",
    blockers: 0,
    nits: 0,
    jevCurrent: true,
    findings: [],
  },
};

const run = (over: Partial<AuthorRun> = {}): AuthorRun => ({
  version: 1,
  status: "running",
  qualityTarget: "spec_valid",
  description: "Managers approve invoices.",
  round: 1,
  at: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("author quality and steps", () => {
  it("targets Ready when a key is present, Spec Valid when not", () => {
    expect(authorQualityTarget(true)).toBe("ready");
    expect(authorQualityTarget(false)).toBe("spec_valid");
    expect(authorQualityMet({ spec: { state: "valid", findings: [] }, ready: { state: "not_yet" } as Health["ready"] }, "spec_valid")).toBe(true);
    expect(authorQualityMet(validReady, "ready")).toBe(true);
    expect(authorQualityMet({ spec: { state: "drafting", findings: [] }, ready: validReady.ready }, "spec_valid")).toBe(false);
  });

  it("waits on questions, stops at Spec Valid without a key, Checks then relaunches toward Ready", () => {
    expect(nextAuthorStep({
      run: run(),
      specState: "drafting",
      readyState: "not_yet",
      jevCurrent: false,
      openQuestions: true,
      hasApiKey: false,
    }).action).toBe("wait_questions");

    const done = nextAuthorStep({
      run: run({ qualityTarget: "spec_valid" }),
      specState: "valid",
      readyState: "not_yet",
      jevCurrent: false,
      openQuestions: false,
      hasApiKey: false,
    });
    expect(done.action).toBe("done");
    expect(done.run.status).toBe("done");

    const check = nextAuthorStep({
      run: run({ qualityTarget: "ready" }),
      specState: "valid",
      readyState: "not_yet",
      jevCurrent: false,
      openQuestions: false,
      hasApiKey: true,
    });
    expect(check.action).toBe("check");

    const afterCheck = nextAuthorStep({
      run: run({ qualityTarget: "ready", round: 2 }),
      specState: "valid",
      readyState: "blocked",
      jevCurrent: true,
      openQuestions: false,
      hasApiKey: true,
      justChecked: true,
    });
    expect(afterCheck.action).toBe("relaunch");
    expect(afterCheck.run.round).toBe(3);

    const cap = nextAuthorStep({
      run: run({ round: AUTHOR_MAX_ROUNDS }),
      specState: "drafting",
      readyState: "not_yet",
      jevCurrent: false,
      openQuestions: false,
      hasApiKey: false,
    });
    expect(cap.action).toBe("capped");
    expect(cap.run.status).toBe("stopped");
  });

  it("offers authoring on a drafting pack and overlays Start without a health.json key", () => {
    expect(shouldOfferAuthor(drafting, null)).toBe(true);
    expect(shouldOfferAuthor({ spec: { state: "valid", findings: [] } }, null)).toBe(false);
    const health: Health = {
      requirementId: "demo",
      spec: { state: "drafting", findings: [] },
      ready: { state: "not_yet", reason: "spec_invalid", blockers: 0, nits: 0, jevCurrent: false, findings: [] },
      build: { state: "not_yet" },
      proof: { state: "not_yet", runtime: true, findings: [] },
      nextAction: { id: "fix-spec", label: "Fix the spec", enabled: true },
      howThisIsGoing: "Drafting.",
    };
    const gated = applyAuthorGate(health, null);
    expect(gated.nextAction).toMatchObject({ id: "author-start", label: "Start" });
    expect(gated).not.toHaveProperty("author");
    expect(Object.keys(gated).sort()).toEqual(Object.keys(health).sort());
  });
});

describe("author markdown and brief", () => {
  it("replaces the starter template with frozen grammar and the owner overview", () => {
    const seeded = seedAuthorMarkdown(
      "invoice-approval",
      "Managers approve invoices in their department.",
      "# Untitled Requirement\n\n> **Template guidance**\n\n## Description [Required]\n",
    );
    expect(seeded).toContain("# Invoice Approval");
    expect(seeded).toContain("## Overview");
    expect(seeded).toContain("Managers approve invoices in their department.");
    expect(seeded).toContain("## Business Rules");
    expect(seeded).toContain("## Roles & Permissions");
    expect(seeded).not.toContain("## Description");
    expect(seeded).not.toContain("Template guidance");
  });

  it("summarizes sibling packs without dumping the whole file", () => {
    const summary = summarizeRequirementMarkdown(
      "invoice-approval",
      "# Invoice approval\n\n## Overview\n\nDepartment managers approve invoices.\n\n## Business Rules\n\nId: BR-001\n\n## Use Cases\n\nActor: Manager\nId: UC-001\n",
    );
    expect(summary).toMatchObject({
      id: "invoice-approval",
      title: "Invoice approval",
      actors: ["Manager"],
    });
    expect(summary.specIds).toEqual(["BR-001", "UC-001"]);
    expect(summary.overview).toContain("Department managers");
  });

  it("tells the writer not to guess and to use frozen grammar", () => {
    const brief = emitAuthorBrief({
      id: "new-pack",
      description: "Viewers can list invoices.",
      qualityTarget: "spec_valid",
      round: 1,
      markdown: "# New pack\n",
      compileFindings: [{ line: 1, severity: "error", message: "Missing required section \"## Business Rules\"." }],
      spec: null,
      ready: null,
      siblings: [],
      product: {
        empty: false,
        stack: "Next.js",
        adapter: "cursor",
        layout: "app/, package.json",
        instruction: "This repo already has a product app.",
      },
      contextFiles: ["mock.png"],
    });
    expect(brief).toContain("Do not guess");
    expect(brief).toContain("channel\": \"author\"");
    expect(brief).toContain("context/mock.png");
    expect(brief).toContain("You may assign the **first** BR- and UC- IDs");
    expect(brief).not.toContain("Do not invent BR- or UC- IDs");
  });
});

describe("author artifacts", () => {
  it("sanitizes names and rejects other types", () => {
    expect(sanitizeArtifactFilename("../x.PNG", "image/png")).toBe("x.png");
    expect(sanitizeArtifactFilename("Approval Screen.jpg", "image/jpeg")).toBe("Approval-Screen.jpg");
    expect(() => sanitizeArtifactFilename("notes.pdf", "application/pdf")).toThrow(AuthorArtifactError);
    const bytes = decodeArtifactData(Buffer.from("hello").toString("base64"), "image/png");
    expect(bytes.toString()).toBe("hello");
  });

  it("round-trips author-run.json", () => {
    const parsed = parseAuthorRun(run({ status: "waiting_questions" }));
    expect(parsed?.status).toBe("waiting_questions");
    expect(parseAuthorRun({ version: 1, status: "running" })).toBeNull();
  });
});
