import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Req0Config } from "./types.js";

export const CONVENTION_SYSTEM_REL = "docs/system.md";

export type LoadedSystemMap = {
  path: string;
  text: string;
  exists: boolean;
};

function displayPath(repoRoot: string | null, abs: string): string {
  if (!repoRoot) return CONVENTION_SYSTEM_REL;
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(abs);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved === root || resolved.startsWith(prefix)) {
    return path.relative(root, resolved).split(path.sep).join("/") || ".";
  }
  return abs;
}

export async function loadSystemMap(
  repoRoot: string | null,
  config?: Req0Config | null,
): Promise<LoadedSystemMap> {
  if (!repoRoot) {
    return { path: CONVENTION_SYSTEM_REL, text: "", exists: false };
  }
  const configured =
    typeof config?.system === "string" && config.system.trim()
      ? path.isAbsolute(config.system)
        ? config.system
        : path.resolve(repoRoot, config.system)
      : null;
  const abs = configured ?? path.join(repoRoot, CONVENTION_SYSTEM_REL);
  try {
    const text = await readFile(abs, "utf8");
    return { path: displayPath(repoRoot, abs), text, exists: true };
  } catch {
    return { path: displayPath(repoRoot, abs), text: "", exists: false };
  }
}

export function systemMapBriefSection(system: LoadedSystemMap | null | undefined): string[] {
  if (!system) return [];
  const pointer = system.exists
    ? `Read \`${system.path}\`. That file is the as-built schema (entities, relationships). Do not treat it as the spec — \`requirement.md\` is the spec.`
    : `\`${system.path}\` does not exist yet. This is the first map. Propose entities in the plan; the coding agent writes the file after a successful Implement.`;
  return [
    "## System map",
    "",
    pointer,
    "Recommended headings (not compiled): Entities, Relationships, Notes. Optional mermaid is illustration only.",
    "",
  ];
}
