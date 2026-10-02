import type { AdapterId } from "./types.js";

export const ADAPTER_IDS = ["cursor", "copilot", "claude", "codex", "manual"] as const;

export function parseAdapterId(raw: unknown): AdapterId | null {
  if (typeof raw !== "string") return null;
  return (ADAPTER_IDS as readonly string[]).includes(raw) ? (raw as AdapterId) : null;
}

export function adapterDisplayName(adapter: AdapterId): string {
  if (adapter === "copilot") return "Copilot";
  if (adapter === "claude") return "Claude";
  if (adapter === "codex") return "Codex";
  if (adapter === "manual") return "Manual";
  return "Cursor";
}

export function adapterLaunchesAgent(adapter: AdapterId): boolean {
  return adapter !== "manual";
}
