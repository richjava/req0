import { spawn } from "node:child_process";
import type { AdapterId, CompileResult } from "./types.js";

export class ImplementLockedError extends Error {
  readonly code = "ready_gate";

  constructor(message = "Implement is locked until Ready is Ready. Check this spec with Jev first.") {
    super(message);
    this.name = "ImplementLockedError";
  }
}

export function adapterInstructions(adapter: AdapterId, briefPath: string): string {
  if (adapter === "cursor") {
    return `Cursor adapter: open this repo in Cursor and keep ${briefPath} in context. Do not invent spec IDs.`;
  }
  return `Manual adapter: open ${briefPath} in any coding agent and implement from that brief.`;
}

export function assertImplementAllowed(result: CompileResult): void {
  if (result.health.ready.state !== "ready") {
    throw new ImplementLockedError();
  }
}

export function launchAdapter(
  adapter: AdapterId,
  repoRoot: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (adapter === "manual") {
    return Promise.resolve({
      ok: true,
      message:
        "Manual adapter: open derived/implement-brief.md in your coding agent. Build Succeeded is not proof the app boots.",
    });
  }
  if (!repoRoot) {
    return Promise.resolve({
      ok: false,
      message: "No product repo root, so Cursor cannot be launched. Use the manual adapter.",
    });
  }
  return new Promise((resolve) => {
    const child = spawn("cursor", [repoRoot], { detached: true, stdio: "ignore" });
    child.once("error", () => {
      resolve({
        ok: false,
        message: "Cursor CLI was not found. Install it, or retry with the manual adapter.",
      });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({
        ok: true,
        message:
          "Opened the repo in Cursor. Keep derived/implement-brief.md in context. Build Succeeded is not proof the app boots.",
      });
    });
  });
}
