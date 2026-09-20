/** Ready / Proof confidence gates. One global pair; do not invent per-pack thresholds. */
export const NOUL_PASS = 0.75;
export const NOUL_FAIL = 0.15;

export const JEV_CATALOG = "m2-authoring-v1" as const;
export const JEV_MODEL = "jev-latest";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const SECTION_SCORE_LEVELS = ["empty", "partial", "agent-ready"] as const;
