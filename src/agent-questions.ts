import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import type { Health, StageBoard } from "./types.js";

export type AgentQuestionsPaths = {
  derived: string;
  agentQuestions: string;
};

export const AGENT_QUESTIONS_FILE = "agent-questions.json";
export const AGENT_QUESTIONS_PATH = `derived/${AGENT_QUESTIONS_FILE}`;
export const AGENT_QUESTIONS_WAITING = "Waiting on owner questions.";

export class AgentAnswersError extends Error {
  readonly code = "agent_answers";

  constructor(message: string) {
    super(message);
    this.name = "AgentAnswersError";
  }
}

export type AgentQuestionsChannel = "improve" | "implement";

export type AgentQuestionKind = "text" | "choice";

export type AgentQuestionOption = {
  id: string;
  label: string;
};

export type AgentQuestionAnswer = {
  text?: string;
  optionId?: string;
};

export type AgentQuestion = {
  id: string;
  prompt: string;
  kind: AgentQuestionKind;
  options?: AgentQuestionOption[];
  required: boolean;
  answer?: AgentQuestionAnswer;
};

export type AgentQuestionsRound = {
  version: 1;
  channel: AgentQuestionsChannel;
  status: "open" | "answered";
  at: string;
  questions: AgentQuestion[];
};

export function questionsBriefSection(): string {
  return [
    "## If you must ask",
    "",
    "Do not guess a required decision (trade-off, missing intent, real test user vs fixture). Do not invent BR- or UC- IDs.",
    `Write \`${AGENT_QUESTIONS_PATH}\` using the shape below, replace the file, then **stop**. Do not patch \`requirement.md\` or product code in the same turn.`,
    "The owner answers in the cockpit. The next launch includes those answers. Then continue.",
    "Do not put secrets in this file.",
    "",
    "~~~~json",
    JSON.stringify(
      {
        version: 1,
        channel: "implement",
        status: "open",
        at: "2026-01-01T00:00:00.000Z",
        questions: [
          {
            id: "q1",
            prompt: "Which option should we take?",
            kind: "choice",
            options: [
              { id: "a", label: "Option A" },
              { id: "b", label: "Option B" },
            ],
            required: true,
          },
          {
            id: "q2",
            prompt: "Any extra note for the owner?",
            kind: "text",
            required: false,
          },
        ],
      },
      null,
      2,
    ),
    "~~~~",
    "",
    "Set `channel` to `improve` when patching the requirement pack, or `implement` when writing product code.",
    "",
  ].join("\n");
}

export function parseAgentQuestions(raw: unknown): AgentQuestionsRound | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (body.version !== 1) return null;
  if (body.channel !== "improve" && body.channel !== "implement") return null;
  if (body.status !== "open" && body.status !== "answered") return null;
  if (typeof body.at !== "string" || !body.at.trim()) return null;
  if (!Array.isArray(body.questions) || body.questions.length === 0) return null;
  const questions: AgentQuestion[] = [];
  for (const item of body.questions) {
    const parsed = parseQuestion(item);
    if (!parsed) return null;
    questions.push(parsed);
  }
  const ids = new Set(questions.map((question) => question.id));
  if (ids.size !== questions.length) return null;
  return {
    version: 1,
    channel: body.channel,
    status: body.status,
    at: body.at,
    questions,
  };
}

export async function readAgentQuestions(paths: AgentQuestionsPaths): Promise<AgentQuestionsRound | null> {
  try {
    return parseAgentQuestions(JSON.parse(await readFile(paths.agentQuestions, "utf8")));
  } catch {
    return null;
  }
}

export async function writeAgentQuestions(paths: AgentQuestionsPaths, round: AgentQuestionsRound): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.agentQuestions, `${JSON.stringify(round, null, 2)}\n`, "utf8");
}

export async function clearAgentQuestions(paths: AgentQuestionsPaths): Promise<void> {
  await unlink(paths.agentQuestions).catch(() => undefined);
}

export function isOpenQuestions(round: AgentQuestionsRound | null | undefined): round is AgentQuestionsRound {
  return Boolean(round && round.status === "open" && round.questions.length > 0);
}

export function requiredUnanswered(round: AgentQuestionsRound): AgentQuestion[] {
  return round.questions.filter((question) => question.required && !hasAnswer(question));
}

export function applyAnswers(round: AgentQuestionsRound, answers: Record<string, string>): AgentQuestionsRound {
  if (!isOpenQuestions(round)) {
    throw new AgentAnswersError("No open questions to answer.");
  }
  const next: AgentQuestion[] = round.questions.map((question) => {
    const raw = answers[question.id];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      if (question.required) {
        throw new AgentAnswersError(`Answer is required: ${question.id}.`);
      }
      return { ...question, answer: undefined };
    }
    if (question.kind === "choice") {
      const option = (question.options ?? []).find((item) => item.id === value);
      if (!option) {
        throw new AgentAnswersError(`Unknown option for ${question.id}.`);
      }
      return { ...question, answer: { optionId: option.id } };
    }
    return { ...question, answer: { text: value } };
  });
  const unknown = Object.keys(answers).filter((id) => !round.questions.some((question) => question.id === id));
  if (unknown.length) {
    throw new AgentAnswersError(`Unknown question id: ${unknown[0]}.`);
  }
  return {
    ...round,
    status: "answered",
    at: new Date().toISOString(),
    questions: next,
  };
}

export function formatOwnerAnswers(round: AgentQuestionsRound): string {
  const lines = ["Owner answers:", ""];
  for (const question of round.questions) {
    const answer = answerLabel(question);
    if (!answer) continue;
    lines.push(`- ${question.id}: ${question.prompt}`);
    lines.push(`  Answer: ${answer}`);
  }
  if (lines.length === 2) return "";
  lines.push("");
  lines.push("Use these answers. Do not ask the same questions again unless a new required decision appears.");
  return lines.join("\n");
}

export function withOwnerAnswers(prompt: string, round: AgentQuestionsRound | null): string {
  if (!round || round.status !== "answered") return prompt;
  const block = formatOwnerAnswers(round);
  if (!block) return prompt;
  return `${prompt}\n\n${block}`;
}

export function applyAgentQuestionsGate(health: Health, round: AgentQuestionsRound | null): Health {
  if (!isOpenQuestions(round) || !health.stages) return health;
  const improve = round.channel === "improve";
  return {
    ...health,
    howThisIsGoing: "The agent has questions.",
    nextAction: {
      id: "answer-questions",
      label: "Continue",
      enabled: true,
      hint: "Answer each required question, then Continue.",
    },
    stages: gateStages(health.stages, improve),
  };
}

function gateStages(stages: StageBoard, improve: boolean): StageBoard {
  return {
    ready: {
      ...stages.ready,
      enabled: false,
      hint: improve ? "Answer the agent's questions on Define." : stages.ready.hint,
    },
    build: improve
      ? { ...stages.build, enabled: false }
      : {
          id: "answer-questions",
          label: "Continue",
          enabled: false,
          hidden: true,
          hint: "Answer the agent's questions.",
        },
    proof: { ...stages.proof, enabled: false },
    ...(stages.fixFromProof ? { fixFromProof: { ...stages.fixFromProof, enabled: false } } : {}),
    ...(stages.ignoreBuild ? { ignoreBuild: { ...stages.ignoreBuild, enabled: false } } : {}),
    ...(stages.stopImplement
      ? {
          stopImplement: improve
            ? { ...stages.stopImplement, enabled: false }
            : {
                id: "stop-implement",
                label: "Stop",
                enabled: true,
                hint: "Discard unanswered questions. Build stays failed until you Reimplement or Ignore.",
              },
        }
      : !improve
        ? {
            stopImplement: {
              id: "stop-implement",
              label: "Stop",
              enabled: true,
              hint: "Discard unanswered questions. Build stays failed until you Reimplement or Ignore.",
            },
          }
        : {}),
  };
}

function parseQuestion(raw: unknown): AgentQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id.trim()) return null;
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return null;
  if (body.kind !== "text" && body.kind !== "choice") return null;
  const required = body.required === false ? false : true;
  let options: AgentQuestionOption[] | undefined;
  if (body.kind === "choice") {
    if (!Array.isArray(body.options) || body.options.length < 2) return null;
    options = [];
    const ids = new Set<string>();
    for (const item of body.options) {
      if (!item || typeof item !== "object") return null;
      const option = item as Record<string, unknown>;
      if (typeof option.id !== "string" || !option.id.trim()) return null;
      if (typeof option.label !== "string" || !option.label.trim()) return null;
      if (ids.has(option.id)) return null;
      ids.add(option.id);
      options.push({ id: option.id, label: option.label });
    }
  }
  let answer: AgentQuestionAnswer | undefined;
  if (body.answer && typeof body.answer === "object") {
    const value = body.answer as Record<string, unknown>;
    if (typeof value.text === "string" && value.text.trim()) answer = { text: value.text.trim() };
    if (typeof value.optionId === "string" && value.optionId.trim()) {
      answer = { ...answer, optionId: value.optionId.trim() };
    }
  }
  return {
    id: body.id.trim(),
    prompt: body.prompt.trim(),
    kind: body.kind,
    ...(options ? { options } : {}),
    required,
    ...(answer ? { answer } : {}),
  };
}

function hasAnswer(question: AgentQuestion): boolean {
  return Boolean(question.answer?.text?.trim() || question.answer?.optionId?.trim());
}

function answerLabel(question: AgentQuestion): string {
  if (question.kind === "choice") {
    const id = question.answer?.optionId;
    const option = question.options?.find((item) => item.id === id);
    return option?.label ?? id ?? "";
  }
  return question.answer?.text?.trim() ?? "";
}
