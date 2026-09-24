import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { findingKeys } from "./improve.js";
import type { PackPaths } from "./pack.js";
import type { ReadyFinding } from "./types.js";

export type ImproveLog = {
  accepted: string[];
  pending: string[];
};

export async function readImproveLog(paths: PackPaths): Promise<ImproveLog> {
  try {
    const raw = JSON.parse(await readFile(paths.improveLog, "utf8")) as ImproveLog;
    return {
      accepted: Array.isArray(raw.accepted) ? raw.accepted.map(String) : [],
      pending: Array.isArray(raw.pending) ? raw.pending.map(String) : [],
    };
  } catch {
    return { accepted: [], pending: [] };
  }
}

export async function recordImprovePending(
  paths: PackPaths,
  findings: ReadyFinding | ReadyFinding[],
): Promise<void> {
  const list = Array.isArray(findings) ? findings : [findings];
  const log = await readImproveLog(paths);
  log.pending = [...new Set(list.flatMap(findingKeys))];
  await writeImproveLog(paths, log);
}

export async function commitImprovePending(paths: PackPaths): Promise<void> {
  const log = await readImproveLog(paths);
  log.accepted = [...new Set([...log.accepted, ...log.pending])];
  log.pending = [];
  await writeImproveLog(paths, log);
}

export async function clearImprovePending(paths: PackPaths): Promise<void> {
  const log = await readImproveLog(paths);
  log.pending = [];
  await writeImproveLog(paths, log);
}

export async function clearImproveLog(paths: PackPaths): Promise<void> {
  await unlink(paths.improveLog).catch(() => undefined);
}

async function writeImproveLog(paths: PackPaths, log: ImproveLog): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.improveLog, `${JSON.stringify(log, null, 2)}\n`, "utf8");
}
