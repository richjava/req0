import { JEV_ENDPOINT, JEV_MODEL } from "./gates.js";
import type { JevAnswer, JevPack, JevQuestionType } from "./types.js";

export class JevUnavailableError extends Error {
  readonly code = "no_api_key";

  constructor(message = "No TypeSafe API key. Set TYPESAFE_API_KEY.") {
    super(message);
    this.name = "JevUnavailableError";
  }
}

export class JevRequestError extends Error {
  readonly code = "jev_request";
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevRequestError";
    this.status = status;
  }
}

export type JevClient = {
  judge(pack: JevPack): Promise<JevAnswer[]>;
};

export function jevApiKey(): string | undefined {
  const key = process.env.TYPESAFE_API_KEY;
  return key?.trim() || undefined;
}

export function hasJevAccess(): boolean {
  return Boolean(jevApiKey()) || process.env.REQ0_JEV === "mock";
}

export function resolveJevClient(): JevClient {
  if (process.env.REQ0_JEV === "mock") return createMockJevClient();
  const key = jevApiKey();
  if (!key) return createUnavailableJevClient();
  return createTypeSafeJevClient(key);
}

export function createUnavailableJevClient(): JevClient {
  return {
    async judge() {
      throw new JevUnavailableError();
    },
  };
}

export function createMockJevClient(overrides?: {
  noul?: Record<string, number>;
  choice?: string;
  score?: Record<string, number>;
}): JevClient {
  return {
    async judge(pack) {
      return pack.questions.map((question) => {
        if (question.type === "noul") {
          const noul =
            overrides?.noul?.[question.id] ??
            noulByPrefix(overrides?.noul, question.id) ??
            (question.id.startsWith("usecase.contradicts.") ? 0.05 : 0.95);
          return { id: question.id, type: "noul", noul, confidence: 1 };
        }
        if (question.type === "choice") {
          const keys = question.criteria && !Array.isArray(question.criteria) ? Object.keys(question.criteria) : [];
          return {
            id: question.id,
            type: "choice",
            choice: overrides?.choice ?? keys[0] ?? "",
            confidence: 1,
          };
        }
        const score =
          overrides?.score?.[question.id] ??
          noulByPrefix(overrides?.score, question.id) ??
          2;
        return { id: question.id, type: "score", score, confidence: 1 };
      });
    },
  };
}

function noulByPrefix(map: Record<string, number> | undefined, id: string): number | undefined {
  if (!map) return undefined;
  if (id in map) return map[id];
  const hit = Object.keys(map).find((key) => id.startsWith(key));
  return hit ? map[hit] : undefined;
}

export function createTypeSafeJevClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): JevClient {
  return {
    async judge(pack) {
      const questions: Record<string, Record<string, unknown>> = {};
      const combinedState: Record<string, unknown> = {};
      for (const question of pack.questions) {
        questions[question.id] = {
          type: question.type,
          instructions: question.instructions,
          ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
        };
        combinedState[question.id] = question.state;
      }

      const response = await fetchImpl(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: { catalog: pack.catalog, requirementId: pack.requirementId, items: combinedState },
          questions,
        }),
      });

      const text = await response.text();
      let raw: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          raw = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new JevRequestError(`TypeSafe System One returned non-JSON (HTTP ${response.status}).`, response.status);
        }
      }
      if (!response.ok) {
        const nested = raw.error;
        const message =
          typeof nested === "string"
            ? nested
            : nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string"
              ? (nested as { message: string }).message
              : `TypeSafe System One returned HTTP ${response.status}.`;
        throw new JevRequestError(message, response.status);
      }

      const answers = extractAnswers(raw);
      return pack.questions.map((question) => normalizeAnswer(question.id, question.type, answers[question.id]));
    },
  };
}

function extractAnswers(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.answers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const { model: _model, usage: _usage, ...rest } = body;
  return rest;
}

function normalizeAnswer(id: string, type: JevQuestionType, raw: unknown): JevAnswer {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    id,
    type,
    noul: typeof value.noul === "number" ? value.noul : undefined,
    choice: typeof value.choice === "string" ? value.choice : undefined,
    score: typeof value.score === "number" ? value.score : undefined,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
  };
}
