import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { unifiedDiff, type DiffHunk } from "./diff.js";
import { clearImprovePending, commitImprovePending } from "./improve-log.js";
import type { Health, StageBoard } from "./types.js";
import type { PackPaths } from "./pack.js";

export const IMPROVE_REVIEW_FILES = ["requirement.md", "fixtures/personas.yaml"] as const;

export class ImproveReviewPendingError extends Error {
  readonly code = "improve_review_pending";

  constructor(message = "Accept or reject the Improve patch first.") {
    super(message);
    this.name = "ImproveReviewPendingError";
  }
}

export class ImproveLintError extends Error {
  readonly code = "improve_lint";

  constructor(message = "Improve patch uses matrix talk. Reject it.") {
    super(message);
    this.name = "ImproveLintError";
  }
}

export const MATRIX_TALK = /\bis allow\b|\bis deny\b|without changing the matrix cell/i;

export type ImproveSnapshotFile = {
  relative: (typeof IMPROVE_REVIEW_FILES)[number];
  content: string | null;
};

export type ImproveSnapshot = {
  at: string;
  files: ImproveSnapshotFile[];
};

export type ImproveFileDiff = {
  relative: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};

export type ImproveLint = {
  ok: boolean;
  messages: string[];
};

export type ImproveReview = {
  at: string;
  waiting: boolean;
  files: ImproveFileDiff[];
  lint: ImproveLint;
};

const REVIEW_ABS: Record<(typeof IMPROVE_REVIEW_FILES)[number], (paths: PackPaths) => string> = {
  "requirement.md": (paths) => paths.requirement,
  "fixtures/personas.yaml": (paths) => paths.personas,
};

export async function readImproveSnapshot(paths: PackPaths): Promise<ImproveSnapshot | null> {
  try {
    const raw = JSON.parse(await readFile(paths.improveSnapshot, "utf8")) as ImproveSnapshot;
    if (!raw.at || !Array.isArray(raw.files)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function beginImproveReview(paths: PackPaths): Promise<ImproveSnapshot> {
  if (await readImproveSnapshot(paths)) {
    throw new ImproveReviewPendingError();
  }
  const snapshot: ImproveSnapshot = {
    at: new Date().toISOString(),
    files: await Promise.all(
      IMPROVE_REVIEW_FILES.map(async (relative) => ({
        relative,
        content: await readReviewFile(paths, relative),
      })),
    ),
  };
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.improveSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

export async function evaluateImproveReview(paths: PackPaths): Promise<ImproveReview | null> {
  const snapshot = await readImproveSnapshot(paths);
  if (!snapshot) return null;
  const files: ImproveFileDiff[] = [];
  for (const entry of snapshot.files) {
    if (!isReviewFile(entry.relative)) continue;
    const current = await readReviewFile(paths, entry.relative);
    if (current === entry.content) continue;
    const hunks = unifiedDiff(entry.content, current);
    const additions = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === "add").length, 0);
    const deletions = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === "del").length, 0);
    files.push({
      relative: entry.relative,
      status: entry.content == null ? "added" : current == null ? "deleted" : "modified",
      additions,
      deletions,
      hunks,
    });
  }
  return { at: snapshot.at, waiting: files.length === 0, files, lint: lintImproveDiff(files) };
}

export function lintImproveDiff(files: ImproveFileDiff[]): ImproveLint {
  const messages: string[] = [];
  for (const file of files) {
    if (file.relative !== "requirement.md") continue;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== "add" || !MATRIX_TALK.test(line.text)) continue;
        messages.push(`Do not add matrix talk: ${line.text.trim()}`);
      }
    }
  }
  return { ok: messages.length === 0, messages };
}

export async function acceptImproveReview(paths: PackPaths): Promise<void> {
  const review = await evaluateImproveReview(paths);
  if (!review) {
    throw new ImproveReviewPendingError("No Improve patch to review.");
  }
  if (!review.lint.ok) {
    throw new ImproveLintError(review.lint.messages[0] ?? "Improve patch uses matrix talk. Reject it.");
  }
  await commitImprovePending(paths);
  await clearImproveSnapshot(paths);
}

export async function rejectImproveReview(paths: PackPaths): Promise<void> {
  const snapshot = await readImproveSnapshot(paths);
  if (!snapshot) {
    throw new ImproveReviewPendingError("No Improve patch to review.");
  }
  for (const entry of snapshot.files) {
    if (!isReviewFile(entry.relative)) continue;
    const file = REVIEW_ABS[entry.relative](paths);
    if (entry.content == null) {
      await unlink(file).catch(() => undefined);
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.content, "utf8");
    }
  }
  await clearImprovePending(paths);
  await clearImproveSnapshot(paths);
}

export function applyImproveReviewGate(health: Health, review: ImproveReview | null): Health {
  if (!review || !health.stages) return health;
  if (review.files.length === 0) {
    return {
      ...health,
      howThisIsGoing: "Waiting for the Improve patch.",
      nextAction: {
        id: "review-improve",
        label: "Waiting for the patch",
        enabled: false,
        hint: "Reject to cancel and keep the current spec.",
      },
      stages: gateStages(health.stages, false),
    };
  }
  const lintOk = review.lint?.ok !== false;
  return {
    ...health,
    howThisIsGoing: lintOk
      ? "Review the Improve patch."
      : "Improve patch uses matrix talk. Reject it.",
    nextAction: {
      id: "review-improve",
      label: "Accept the patch",
      enabled: lintOk,
      hint: lintOk
        ? "Or reject to restore the spec from before Improve."
        : review.lint?.messages[0] ?? "Outcome must not say is allow or is deny.",
    },
    stages: gateStages(health.stages, true),
  };
}

function gateStages(stages: StageBoard, hasDiff: boolean): StageBoard {
  return {
    ready: {
      id: hasDiff ? "review-improve" : "improve",
      label: hasDiff ? "Review" : "Improve it",
      enabled: false,
      hint: hasDiff ? "Accept or reject the Improve diff." : "A patch is in flight.",
    },
    build: { ...stages.build, enabled: false },
    proof: { ...stages.proof, enabled: false },
    ...(stages.fixFromProof ? { fixFromProof: { ...stages.fixFromProof, enabled: false } } : {}),
    ...(stages.ignoreBuild ? { ignoreBuild: { ...stages.ignoreBuild, enabled: false } } : {}),
    ...(stages.stopImplement ? { stopImplement: { ...stages.stopImplement, enabled: false } } : {}),
  };
}

async function readReviewFile(paths: PackPaths, relative: (typeof IMPROVE_REVIEW_FILES)[number]): Promise<string | null> {
  try {
    return await readFile(REVIEW_ABS[relative](paths), "utf8");
  } catch {
    return null;
  }
}

async function clearImproveSnapshot(paths: PackPaths): Promise<void> {
  await unlink(paths.improveSnapshot).catch(() => undefined);
}

function isReviewFile(relative: string): relative is (typeof IMPROVE_REVIEW_FILES)[number] {
  return (IMPROVE_REVIEW_FILES as readonly string[]).includes(relative);
}
