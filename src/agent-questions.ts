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

export type AgentQuestionsChannel = "author" | "improve" | "implement";

export type AgentQuestionKind = "text" | "choice" | "artifact";

export const SKIP_ANSWER = "__skip__";

export const AUTHOR_ARTIFACT_ACCEPT = ["image/png", "image/jpeg", "image/webp"] as const;

export type AgentQuestionOption = {
  id: string;
  label: string;
};

export type AgentQuestionAnswer = {
  text?: string;
  optionId?: string;
  skipped?: boolean;
  artifact?: string;
};

export type AgentQuestion = {
  id: string;
  prompt: string;
  kind: AgentQuestionKind;
  options?: AgentQuestionOption[];
  required: boolean;
  allowCustom?: boolean;
  accept?: string[];
  answer?: AgentQuestionAnswer;
};

export type AgentQuestionsRound = {
  version: 1;
  channel: AgentQuestionsChannel;
  status: "open" | "answered";
  at: string;
  questions: AgentQuestion[];
};

export function questionsBriefSection(
  options: { channel?: AgentQuestionsChannel; inventIds?: boolean } = {},
): string {
  const channel = options.channel ?? "implement";
  const invent = options.inventIds === true;
  return [
    "## If you must ask",
    "",
    invent
      ? "Do not guess a required decision. You may assign the first BR-NNN and UC-NNN IDs in this pack. Do not copy IDs from sibling packs."
      : "Do not guess a required decision (trade-off, missing intent, real test user vs fixture). Do not invent BR- or UC- IDs.",
    `Write \`${AGENT_QUESTIONS_PATH}\` using the shape below, replace the file, then **stop**. Do not patch \`requirement.md\` or product code in the same turn.`,
    "At most four questions. Highest-leverage gaps first. For `choice`, put your recommended option first. Set `allowCustom` true when the owner may type something else.",
    "The owner may skip one question or all of them. Skipped is not an answer: do not assume. Ask a different question later, or leave that gap in `## Open questions`.",
    "If a screenshot or mock would resolve a gap, use `kind: \"artifact\"` (PNG/JPG/WebP). The owner may skip the upload.",
    "The owner answers in the cockpit. The next launch includes those answers. Then continue.",
    "Do not put secrets in this file.",
    "",
    "~~~~json",
    JSON.stringify(
      {
        version: 1,
        channel,
        status: "open",
        at: "2026-01-01T00:00:00.000Z",
        questions: [
          {
            id: "q1",
            prompt: "Which option should we take?",
            kind: "choice",
            options: [
              { id: "a", label: "Option A (recommended)" },
              { id: "b", label: "Option B" },
            ],
            required: true,
            allowCustom: true,
          },
          {
            id: "q2",
            prompt: "Upload a screenshot of the screen this requirement covers, if you have one.",
            kind: "artifact",
            required: false,
            accept: [...AUTHOR_ARTIFACT_ACCEPT],
          },
        ],
      },
      null,
      2,
    ),
    "~~~~",
    "",
    "Set `channel` to `author` when filling a new pack from a description, `improve` when patching after Ready, or `implement` when writing product code.",
    "",
  ].join("\n");
}

export function parseAgentQuestions(raw: unknown): AgentQuestionsRound | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (body.version !== 1) return null;
  if (body.channel !== "author" && body.channel !== "improve" && body.channel !== "implement") return null;
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
  return round.questions.filter((question) => question.required && !hasAnswer(question) && !isSkipped(question));
}

export function applyAnswers(
  round: AgentQuestionsRound,
  answers: Record<string, string>,
  options: { skipAll?: boolean } = {},
): AgentQuestionsRound {
  if (!isOpenQuestions(round)) {
    throw new AgentAnswersError("No open questions to answer.");
  }
  const known = new Set(round.questions.map((question) => question.id));
  const unknown = Object.keys(answers).filter((id) => !known.has(id));
  if (unknown.length) {
    throw new AgentAnswersError(`Unknown question id: ${unknown[0]}.`);
  }
  const next: AgentQuestion[] = round.questions.map((question) => {
    const raw = answers[question.id];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === SKIP_ANSWER || (!value && options.skipAll)) {
      return { ...question, answer: { skipped: true } };
    }
    if (!value) {
      if (question.required) {
        throw new AgentAnswersError(`Answer is required: ${question.id}.`);
      }
      return { ...question, answer: undefined };
    }
    if (question.kind === "choice") {
      const option = (question.options ?? []).find((item) => item.id === value);
      if (option) return { ...question, answer: { optionId: option.id } };
      if (question.allowCustom) return { ...question, answer: { text: value } };
      throw new AgentAnswersError(`Unknown option for ${question.id}.`);
    }
    if (question.kind === "artifact") {
      return { ...question, answer: { artifact: value } };
    }
    return { ...question, answer: { text: value } };
  });
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
  lines.push("Skipped questions are not answers. Do not invent facts for them.");
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
  const defineSide = round.channel === "improve" || round.channel === "author";
  return {
    ...health,
    howThisIsGoing: "The agent has questions.",
    nextAction: {
      id: "answer-questions",
      label: "Continue",
      enabled: true,
      hint: "Answer each required question, then Continue. You may skip a question or all of them.",
    },
    stages: gateStages(health.stages, defineSide),
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
  if (body.kind !== "text" && body.kind !== "choice" && body.kind !== "artifact") return null;
  const required = body.kind === "artifact" ? body.required === true : body.required === false ? false : true;
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
  let accept: string[] | undefined;
  if (body.kind === "artifact") {
    if (Array.isArray(body.accept) && body.accept.length) {
      accept = body.accept.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
      if (!accept.length) accept = [...AUTHOR_ARTIFACT_ACCEPT];
    } else {
      accept = [...AUTHOR_ARTIFACT_ACCEPT];
    }
  }
  let answer: AgentQuestionAnswer | undefined;
  if (body.answer && typeof body.answer === "object") {
    const value = body.answer as Record<string, unknown>;
    if (value.skipped === true) answer = { skipped: true };
    if (typeof value.text === "string" && value.text.trim()) answer = { ...answer, text: value.text.trim() };
    if (typeof value.optionId === "string" && value.optionId.trim()) {
      answer = { ...answer, optionId: value.optionId.trim() };
    }
    if (typeof value.artifact === "string" && value.artifact.trim()) {
      answer = { ...answer, artifact: value.artifact.trim() };
    }
  }
  return {
    id: body.id.trim(),
    prompt: body.prompt.trim(),
    kind: body.kind,
    ...(options ? { options } : {}),
    required,
    ...(body.kind === "choice" && body.allowCustom === true ? { allowCustom: true } : {}),
    ...(accept ? { accept } : {}),
    ...(answer ? { answer } : {}),
  };
}

function hasAnswer(question: AgentQuestion): boolean {
  return Boolean(
    question.answer?.text?.trim() || question.answer?.optionId?.trim() || question.answer?.artifact?.trim(),
  );
}

function isSkipped(question: AgentQuestion): boolean {
  return question.answer?.skipped === true;
}

function answerLabel(question: AgentQuestion): string {
  if (question.answer?.skipped) return "Skipped. Do not assume an answer.";
  if (question.answer?.artifact) return `Uploaded context/${question.answer.artifact}. Read that file.`;
  if (question.kind === "choice") {
    const id = question.answer?.optionId;
    const option = question.options?.find((item) => item.id === id);
    if (option) return option.label;
    if (question.allowCustom && question.answer?.text?.trim()) return question.answer.text.trim();
    return id ?? "";
  }
  return question.answer?.text?.trim() ?? "";
}
