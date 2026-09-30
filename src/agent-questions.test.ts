import { describe, expect, it } from "vitest";
import {
  AGENT_QUESTIONS_PATH,
  applyAgentQuestionsGate,
  applyAnswers,
  AgentAnswersError,
  formatOwnerAnswers,
  isOpenQuestions,
  parseAgentQuestions,
  questionsBriefSection,
  requiredUnanswered,
  withOwnerAnswers,
} from "./agent-questions.js";
import type { Health } from "./types.js";

const openRound = {
  version: 1 as const,
  channel: "implement" as const,
  status: "open" as const,
  at: "2026-09-29T10:00:00.000Z",
  questions: [
    {
      id: "q1",
      prompt: "Which storage should the invoice list use?",
      kind: "choice" as const,
      options: [
        { id: "dynamo", label: "DynamoDB" },
        { id: "postgres", label: "PostgreSQL" },
      ],
      required: true,
    },
    {
      id: "q2",
      prompt: "Any login copy the owner wants on /login?",
      kind: "text" as const,
      required: false,
    },
  ],
};

const stages: Health["stages"] = {
  ready: { id: "improve", label: "Improve it", enabled: false },
  build: { id: "implement", label: "Implement", enabled: true },
  proof: { id: "prove", label: "Prove", enabled: false },
};

describe("agent questions", () => {
  it("round-trips the v1 file shape", () => {
    const parsed = parseAgentQuestions(JSON.parse(JSON.stringify(openRound)));
    expect(parsed).toEqual(openRound);
    expect(isOpenQuestions(parsed)).toBe(true);
    expect(requiredUnanswered(parsed!).map((question) => question.id)).toEqual(["q1"]);
  });

  it("rejects unknown options and missing required answers", () => {
    expect(() => applyAnswers(openRound, { q1: "s3" })).toThrow(AgentAnswersError);
    expect(() => applyAnswers(openRound, { q2: "Keep the current copy." })).toThrow(/q1/);
    const answered = applyAnswers(openRound, { q1: "postgres", q2: "Keep the current copy." });
    expect(answered.status).toBe("answered");
    expect(answered.questions[0]?.answer).toEqual({ optionId: "postgres" });
    expect(formatOwnerAnswers(answered)).toContain("PostgreSQL");
    expect(withOwnerAnswers("Implement this requirement.", answered)).toContain("Owner answers:");
  });

  it("overlays Continue without adding a health.json key", () => {
    const health: Health = {
      requirementId: "invoice-approval",
      spec: { state: "valid", findings: [] },
      ready: {
        state: "ready",
        reason: "passed",
        blockers: 0,
        nits: 0,
        jevCurrent: true,
        findings: [],
      },
      build: { state: "running" },
      proof: { state: "not_yet", runtime: true, findings: [] },
      nextAction: { id: "stop-implement", label: "Stop", enabled: true },
      stages,
      howThisIsGoing: "Implementing.",
    };
    const gated = applyAgentQuestionsGate(health, openRound);
    expect(gated.nextAction).toMatchObject({ id: "answer-questions", label: "Continue", enabled: true });
    expect(gated.howThisIsGoing).toBe("The agent has questions.");
    expect(gated.stages?.build).toMatchObject({ id: "answer-questions", hidden: true, enabled: false });
    expect(gated.stages?.stopImplement).toMatchObject({ id: "stop-implement", enabled: true });
    expect(gated.stages?.ready.id).not.toBe("answer-questions");
    expect(gated).not.toHaveProperty("questions");
    expect(Object.keys(gated).sort()).toEqual(Object.keys(health).sort());
    const improve = applyAgentQuestionsGate(health, { ...openRound, channel: "improve" });
    expect(improve.nextAction.id).toBe("answer-questions");
    expect(improve.stages?.ready.enabled).toBe(false);
    expect(improve.stages?.ready.id).not.toBe("answer-questions");
    expect(questionsBriefSection()).toContain(AGENT_QUESTIONS_PATH);
    expect(questionsBriefSection()).toContain("then **stop**");
    expect(questionsBriefSection()).not.toContain("Do not interview");
  });
});
