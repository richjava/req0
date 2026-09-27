export const REQUIRED_H2 = [
  "Business Rules",
  "Use Cases",
  "Roles & Permissions",
] as const;

export const OPTIONAL_H2 = [
  "Overview",
  "Out of scope",
  "Open questions",
  "Entities",
  "UI notes",
] as const;

export type RequiredH2 = (typeof REQUIRED_H2)[number];
export type OptionalH2 = (typeof OPTIONAL_H2)[number];

export type FindingSeverity = "error" | "warning";

export type Finding = {
  line: number;
  severity: FindingSeverity;
  message: string;
};

export type Permission = "allow" | "deny";

export type BusinessRule = {
  id: string;
  title: string;
  statement: string;
  observable: string;
  line: number;
};

export type UseCase = {
  id: string;
  title: string;
  actor: string;
  preconditions: string;
  steps: string[];
  outcome: string;
  alternatePaths?: string;
  line: number;
};

export type PermissionMatrix = {
  roles: string[];
  actions: {
    id: string;
    permissions: Record<string, Permission>;
    line: number;
  }[];
};

export type SpecAst = {
  requirementId: string;
  title: string;
  optional: Partial<Record<OptionalH2, string>>;
  businessRules: BusinessRule[];
  useCases: UseCase[];
  matrix: PermissionMatrix;
};

export type MeterState = "not_yet" | "empty" | "drafting" | "valid";

export type NextAction = {
  id: string;
  label: string;
  enabled: boolean;
  hint?: string;
};

export type StageAction = {
  id: string;
  label: string;
  enabled: boolean;
  hint?: string;
  hidden?: boolean;
};

export type StageBoard = {
  ready: StageAction;
  build: StageAction;
  proof: StageAction;
  /** Primary after a failed or review proof. Rebuild stays on the build pill. */
  fixFromProof?: StageAction;
  /** Shown on a failed Build so the owner can unlock Prove. */
  ignoreBuild?: StageAction;
  /** Shown while Implement is running. */
  stopImplement?: StageAction;
};

export type ReadyState = "not_yet" | "blocked" | "ready";

export type ReadyReason =
  | "spec_invalid"
  | "no_api_key"
  | "unchecked"
  | "blockers"
  | "passed";

export type ReadyFindingKind =
  | "persona_missing"
  | "untestable_rule"
  | "matrix_contradiction"
  | "pack_gate"
  | "section_score"
  | "uncertain";

export type ReadyFinding = {
  id: string;
  kind: ReadyFindingKind;
  severity: "blocker" | "nit";
  message: string;
  specId?: string;
  line?: number;
  noul?: number;
};

export type ReadyMeter = {
  state: ReadyState;
  reason: ReadyReason;
  blockers: number;
  nits: number;
  nextId?: string;
  packNoul?: number;
  jevCurrent?: boolean;
  alreadyImproved?: string[];
  findings: ReadyFinding[];
};

export type JevQuestionType = "noul" | "choice" | "score";

export type JevQuestion = {
  id: string;
  type: JevQuestionType;
  instructions: string;
  criteria?: Record<string, string> | string[];
  specId?: string;
  section?: string;
  state: Record<string, unknown>;
};

export type JevPack = {
  requirementId: string;
  catalog: "m2-authoring-v1" | "m4-proof-v1";
  questions: JevQuestion[];
};

export type JevAnswer = {
  id: string;
  type: JevQuestionType;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
};

export type JevRun = {
  specHash: string;
  checkedAt: string;
  answers: JevAnswer[];
};

export type AdapterId = "cursor" | "manual";

export type StackChoice = {
  id: string;
  label: string;
};

export type Req0Config = {
  adapter?: AdapterId;
  stack?: StackChoice;
  /** When false, Req0 does not own Implement. Prove uses Ready + runtime.yaml. */
  implement?: boolean;
};

export type ProductRepo = {
  root: string | null;
  empty: boolean;
  stack: StackChoice;
  recorded: boolean;
  adapter: AdapterId;
  implement: boolean;
};

export type BuildState = "not_yet" | "running" | "succeeded" | "failed" | "stale";

export type BuildMeter = {
  state: BuildState;
  /** False when req0.json sets implement: false. Prove does not need a build stamp. */
  owned?: boolean;
  adapter?: AdapterId;
  /** Empty product repo with no stack in req0.json. Implement stays off until one is recorded. */
  needsStack?: boolean;
  message?: string;
  /** Owner ignored a failed Build so Prove can run. */
  ignored?: boolean;
};

export type BuildRun = {
  specHash: string;
  state: "running" | "succeeded" | "failed";
  adapter: AdapterId;
  at: string;
  message?: string;
  /** Cursor agent pid this Req0 process is following. Ignored after restart. */
  pid?: number;
  /** Owner chose Ignore. Prove may run even if state is failed. */
  ignored?: boolean;
};

export type ProofState = "not_yet" | "passed" | "failed" | "needs_review" | "stale";

export type ProofFinding = {
  id: string;
  specId: string;
  severity: "fail" | "review";
  message: string;
  noul?: number;
};

export type ProofMeter = {
  state: ProofState;
  runtime: boolean;
  message?: string;
  passed?: number;
  failed?: number;
  review?: number;
  findings: ProofFinding[];
};

export type ProofVerdict = "pass" | "fail" | "review";

export type ProofCaseResult = {
  id: string;
  kind: "allow" | "deny";
  verdict: ProofVerdict;
  noul?: number;
  message: string;
};

export type ProofRun = {
  specHash: string;
  checkedAt: string;
  buildAt?: string;
  boot: { ok: boolean; message?: string };
  cases: ProofCaseResult[];
};

export type ActivityLevel = "info" | "ok" | "error";

export type ActivityLine = {
  at: string;
  level: ActivityLevel;
  message: string;
};

export type ProgressFn = (message: string, level?: ActivityLevel) => void;

export type Health = {
  requirementId: string;
  spec: {
    state: "empty" | "drafting" | "valid";
    findings: Finding[];
  };
  ready: ReadyMeter;
  build: BuildMeter;
  proof: ProofMeter;
  nextAction: NextAction;
  stages?: StageBoard;
  howThisIsGoing: string;
};

export type CompileResult = {
  spec: SpecAst | null;
  health: Health;
  markdown: string;
  jevPack?: JevPack;
  implementBrief?: string;
  qaPlan?: QaPlan;
};

export type QaCaseKind = "allow" | "deny";

export type QaCase = {
  id: string;
  specId: string;
  kind: QaCaseKind;
  actor: string;
  control: string | null;
  steps: string[];
  preconditions: string;
  outcome: string;
};

export type QaPlan = {
  requirementId: string;
  specHash: string;
  cases: QaCase[];
};
