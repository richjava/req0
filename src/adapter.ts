import type { AdapterId } from "./types.js";

export const ADAPTER_IDS = ["cursor", "copilot", "manual"] as const;

export function parseAdapterId(raw: unknown): AdapterId | null {
  if (raw === "cursor" || raw === "copilot" || raw === "manual") return raw;
  return null;
}

export function adapterDisplayName(adapter: AdapterId): string {
  if (adapter === "copilot") return "Copilot";
  if (adapter === "manual") return "Manual";
  return "Cursor";
}

export function adapterLaunchesAgent(adapter: AdapterId): boolean {
  return adapter === "cursor" || adapter === "copilot";
}
