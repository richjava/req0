import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptImproveReview,
  applyImproveReviewGate,
  beginImproveReview,
  evaluateImproveReview,
  ImproveLintError,
  ImproveReviewPendingError,
  lintImproveDiff,
  rejectImproveReview,
} from "./improve-review.js";
import { readImproveLog, recordImprovePending } from "./improve-log.js";
import { packPaths, writeRequirement } from "./pack.js";
import type { Health } from "./types.js";

const before = "# Hello\n\nline two\n";
const after = "# Hello\n\nline two changed\n";

let parent = "";

afterEach(async () => {
  if (parent) await rm(parent, { recursive: true, force: true });
  parent = "";
});

describe("improve review", () => {
  it("waits until a review file changes, then diffs it", async () => {
    const paths = await tmpPack();
    await beginImproveReview(paths);
    const waiting = await evaluateImproveReview(paths);
    expect(waiting).toMatchObject({ waiting: true, files: [] });

    await writeFile(paths.requirement, after, "utf8");
    const review = await evaluateImproveReview(paths);
    expect(review?.waiting).toBe(false);
    expect(review?.files).toHaveLength(1);
    expect(review?.files[0]).toMatchObject({ relative: "requirement.md", status: "modified" });
    expect(review?.files[0]?.hunks[0]?.lines.some((line) => line.kind === "add" && line.text.includes("changed"))).toBe(
      true,
    );
  });

  it("accept keeps the patch and reject restores the snapshot", async () => {
    const paths = await tmpPack();
    await beginImproveReview(paths);
    await writeFile(paths.requirement, after, "utf8");

    await recordImprovePending(paths, {
      id: "ready.untestable.BR-001",
      kind: "untestable_rule",
      severity: "blocker",
      message: "x",
      specId: "BR-001",
    });
    await acceptImproveReview(paths);
    expect(await readFile(paths.requirement, "utf8")).toBe(after);
    expect(await evaluateImproveReview(paths)).toBeNull();
    expect((await readImproveLog(paths)).accepted).toEqual(["ready.untestable.BR-001", "BR-001"]);

    await beginImproveReview(paths);
    await writeFile(paths.requirement, before, "utf8");
    await rejectImproveReview(paths);
    expect(await readFile(paths.requirement, "utf8")).toBe(after);
    expect(await evaluateImproveReview(paths)).toBeNull();
  });

  it("restores a missing personas file and refuses a second Improve", async () => {
    const paths = await tmpPack();
    await beginImproveReview(paths);
    await expect(beginImproveReview(paths)).rejects.toBeInstanceOf(ImproveReviewPendingError);
    await rm(paths.personas);
    const review = await evaluateImproveReview(paths);
    expect(review?.files[0]).toMatchObject({ relative: "fixtures/personas.yaml", status: "deleted" });
    await rejectImproveReview(paths);
    expect(await readFile(paths.personas, "utf8")).toBe("personas:\n");
  });

  it("blocks cockpit edits while a review is pending", async () => {
    const paths = await tmpPack();
    await beginImproveReview(paths);
    await expect(writeRequirement(paths, after)).rejects.toBeInstanceOf(ImproveReviewPendingError);
    expect(await readFile(paths.requirement, "utf8")).toBe(before);
  });

  it("gates Check and Improve while a review is open", () => {
    const health = applyImproveReviewGate(baseHealth(), {
      at: "2026-01-01T00:00:00.000Z",
      waiting: false,
      files: [
        {
          relative: "requirement.md",
          status: "modified",
          additions: 1,
          deletions: 1,
          hunks: [],
        },
      ],
      lint: { ok: true, messages: [] },
    });
    expect(health.nextAction).toMatchObject({ id: "review-improve", label: "Accept the patch", enabled: true });
    expect(health.stages?.ready.enabled).toBe(false);
    expect(health.stages?.build.enabled).toBe(false);
    expect(health.howThisIsGoing).toBe("Review the Improve patch.");
  });

  it("refuses Accept when the patch adds matrix talk", async () => {
    const lint = lintImproveDiff([
      {
        relative: "requirement.md",
        status: "modified",
        additions: 1,
        deletions: 1,
        hunks: [
          {
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { kind: "del", text: "Outcome: Invoice status is Approved.", oldNo: 1, newNo: null },
              { kind: "add", text: "Outcome: Approve is allow for Manager.", oldNo: null, newNo: 1 },
            ],
          },
        ],
      },
    ]);
    expect(lint.ok).toBe(false);
    expect(lint.messages[0]).toMatch(/is allow/);

    const paths = await tmpPack();
    await beginImproveReview(paths);
    await writeFile(paths.requirement, "Outcome: Approve is allow for Manager.\n", "utf8");
    await expect(acceptImproveReview(paths)).rejects.toBeInstanceOf(ImproveLintError);
    expect(await evaluateImproveReview(paths)).not.toBeNull();
  });
});

async function tmpPack() {
  parent = await mkdtemp(path.join(os.tmpdir(), "req0-review-"));
  const root = path.join(parent, "docs/requirements/demo");
  await mkdir(path.join(root, "fixtures"), { recursive: true });
  const paths = packPaths(root);
  await writeFile(paths.requirement, before, "utf8");
  await writeFile(paths.personas, "personas:\n", "utf8");
  return paths;
}

function baseHealth(): Health {
  return {
    requirementId: "demo",
    spec: { state: "valid", findings: [] },
    ready: { state: "ready", reason: "passed", blockers: 0, nits: 0, findings: [] },
    build: { state: "not_yet" },
    proof: { state: "not_yet", runtime: false, findings: [] },
    nextAction: { id: "implement", label: "Implement this requirement", enabled: true },
    stages: {
      ready: { id: "improve", label: "Improve it", enabled: true },
      build: { id: "implement", label: "Implement", enabled: true },
      proof: { id: "prove", label: "Prove", enabled: false },
    },
    howThisIsGoing: "Ready.",
  };
}
