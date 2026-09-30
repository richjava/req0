import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, access, appendFile, rm } from "node:fs/promises";
import path from "node:path";
import { adapterDisplayName, adapterLaunchesAgent } from "./adapter.js";
import { compileMarkdown, healthToStatusMarkdown, isRequirementId } from "./compile.js";
import {
  assertImplementAllowed,
  ImplementDisabledError,
  fixFromProofPrompt,
  implementPrompt,
  improvePrompt,
  IMPLEMENT_STOPPED,
  launchAdapter,
  requestImplementStop,
  type LaunchAdapterResult,
} from "./implement.js";
import { assertFixFromProofAllowed, emitFixFromProofBrief, FixFromProofLockedError } from "./fix-from-proof.js";
import { assertImproveAllowed, emitImproveBrief, improveFindings } from "./improve.js";
import { clearImproveLog, readImproveLog, recordImprovePending } from "./improve-log.js";
import { beginImproveReview, ImproveReviewPendingError, readImproveSnapshot, rejectImproveReview } from "./improve-review.js";
import { emitImplementBrief } from "./implement-brief.js";
import { hasJevAccess, JevRequestError, JevUnavailableError, resolveJevClient, type JevClient } from "./jev.js";
import { emitJevPack } from "./jev-pack.js";
import { parsePersonasYaml, type PersonasResult } from "./personas.js";
import { emitProofReport } from "./proof-report.js";
import { emitQaPlan, emitQaPlanYaml } from "./qa-plan.js";
import {
  assertProveAllowed,
  evaluateProof,
  persistProofRun,
  provePlan,
  ProveLockedError,
  type ProofDriver,
} from "./proof.js";
import {
  applyReadyToHealth,
  attachReady,
  evaluateBuild,
  followImplementPid,
  IMPLEMENT_INTERRUPTED,
  implementProcessGone,
  IgnoreBuildLockedError,
  isFollowedImplement,
  specHash,
  unfollowImplementPid,
} from "./ready.js";
import { ignoreBuildAllowed, packListMeters } from "./stages.js";
import { parseRuntimeYaml, type RuntimeResult } from "./runtime.js";
import {
  inspectProductRepo,
  needsStackChoice,
  resolveStackId,
  StackRequiredError,
  UnknownStackError,
  writeAmplifyEnvExampleIfMissing,
  writeReq0Config,
} from "./stack.js";
import { loadStarterRequirement, PERSONAS_STUB, RUNTIME_STUB } from "./template.js";
import type { AdapterId, BuildRun, CompileResult, Health, JevRun, PackListItem, ProgressFn, ProofRun, SpecAst } from "./types.js";
import {
  AGENT_QUESTIONS_WAITING,
  AgentAnswersError,
  applyAnswers,
  clearAgentQuestions,
  isOpenQuestions,
  readAgentQuestions,
  withOwnerAnswers,
  writeAgentQuestions,
} from "./agent-questions.js";

export const REQUIREMENT_FILE = "requirement.md";
export const PERSONAS_FILE = path.join("fixtures", "personas.yaml");
export const RUNTIME_FILE = path.join("fixtures", "runtime.yaml");

export type PackPaths = {
  id: string;
  root: string;
  requirement: string;
  personas: string;
  derived: string;
  spec: string;
  health: string;
  status: string;
  jevPack: string;
  jevRun: string;
  implementBrief: string;
  fixFromProofBrief: string;
  improveBrief: string;
  improveSnapshot: string;
  improveLog: string;
  buildRun: string;
  runtime: string;
  qaPlan: string;
  proofRun: string;
  proofReport: string;
  proveLog: string;
  agentQuestions: string;
};

export function packPaths(root: string): PackPaths {
  const id = path.basename(root);
  const derived = path.join(root, "derived");
  return {
    id,
    root,
    requirement: path.join(root, REQUIREMENT_FILE),
    personas: path.join(root, PERSONAS_FILE),
    derived,
    spec: path.join(derived, "spec.json"),
    health: path.join(derived, "health.json"),
    status: path.join(derived, "status.md"),
    jevPack: path.join(derived, "jev-pack.json"),
    jevRun: path.join(derived, "jev-run.json"),
    implementBrief: path.join(derived, "implement-brief.md"),
    fixFromProofBrief: path.join(derived, "fix-from-proof-brief.md"),
    improveBrief: path.join(derived, "improve-brief.md"),
    improveSnapshot: path.join(derived, "improve-snapshot.json"),
    improveLog: path.join(derived, "improve-log.json"),
    buildRun: path.join(derived, "build-run.json"),
    runtime: path.join(root, RUNTIME_FILE),
    qaPlan: path.join(derived, "qa-plan.yaml"),
    proofRun: path.join(derived, "proof-run.json"),
    proofReport: path.join(derived, "proof-report.md"),
    proveLog: path.join(derived, "prove-run.log"),
    agentQuestions: path.join(derived, "agent-questions.json"),
  };
}

export async function withRememberedAnswers(paths: PackPaths, prompt: string): Promise<string> {
  const round = await readAgentQuestions(paths);
  if (!round || round.status !== "answered" || round.channel !== "implement") return prompt;
  return withOwnerAnswers(prompt, round);
}

export async function isPackDir(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, REQUIREMENT_FILE));
    return true;
  } catch {
    return false;
  }
}

export async function resolveCockpitPack(cwd: string): Promise<PackPaths | null> {
  const abs = path.resolve(cwd);
  if (await isPackDir(abs)) return packPaths(abs);

  const id = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  if (isRequirementId(id) && parent === "requirements") {
    return packPaths(abs);
  }
  return null;
}

export async function resolvePack(cwd: string): Promise<PackPaths | null> {
  const fromDir = await resolveCockpitPack(cwd);
  if (fromDir) return fromDir;

  const named = path.join(path.resolve(cwd), "docs", "requirements");
  const packs = await listPacks(named);
  if (packs.length === 1) return packs[0] ?? null;
  return null;
}

export async function summarizePacks(packs: PackPaths[]): Promise<PackListItem[]> {
  const items: PackListItem[] = [];
  for (const pack of packs) {
    items.push(await summarizePack(pack));
  }
  return items;
}

async function summarizePack(paths: PackPaths): Promise<PackListItem> {
  const markdown = await readMarkdown(paths);
  const title = titleFromMarkdown(markdown) || paths.id.replaceAll("-", " ");
  const health = (await readStoredHealth(paths)) ?? (await compilePack(paths)).health;
  return {
    id: paths.id,
    title,
    meters: packListMeters(health, true),
  };
}

function titleFromMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

async function readStoredHealth(paths: PackPaths): Promise<Health | null> {
  try {
    const raw = JSON.parse(await readFile(paths.health, "utf8")) as Partial<Health>;
    if (raw && typeof raw === "object" && raw.spec && raw.ready && raw.build && raw.proof) {
      return raw as Health;
    }
  } catch {
    /* compile on demand */
  }
  return null;
}

export async function listPacks(requirementsDir: string): Promise<PackPaths[]> {
  try {
    const entries = await readdir(requirementsDir, { withFileTypes: true });
    const packs: PackPaths[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = path.join(requirementsDir, entry.name);
      if (await isPackDir(root)) packs.push(packPaths(root));
    }
    return packs.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function findRequirementsDir(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "docs", "requirements");
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export async function readMarkdown(paths: PackPaths): Promise<string> {
  try {
    return await readFile(paths.requirement, "utf8");
  } catch {
    return "";
  }
}

export async function loadPersonas(paths: PackPaths): Promise<PersonasResult> {
  try {
    const text = await readFile(paths.personas, "utf8");
    return parsePersonasYaml(text);
  } catch {
    return {
      personas: new Map(),
      findings: [],
      missingFile: true,
    };
  }
}

export async function compilePack(paths: PackPaths): Promise<CompileResult> {
  const markdown = await readMarkdown(paths);
  let result = compileMarkdown(paths.id, markdown);
  if (result.spec) result = { ...result, jevPack: emitJevPack(result.spec) };
  const personas = await loadPersonas(paths);
  const repo = await inspectProductRepo(paths.root);
  if (repo.root && repo.recorded) {
    await writeAmplifyEnvExampleIfMissing(repo.root, repo.stack);
  }
  if (result.spec) {
    result = {
      ...result,
      implementBrief: emitImplementBrief({
        spec: result.spec,
        repo,
        adapter: repo.adapter,
        personas,
      }),
    };
  }
  const jevRun = result.spec ? await readJevRun(paths, result.spec) : null;
  result = attachReady(result, {
    personas,
    jevRun,
    hasApiKey: hasJevAccess(),
  });
  const improved = (await readImproveLog(paths)).accepted;
  if (improved.length) {
    result.health.ready = { ...result.health.ready, alreadyImproved: improved };
  }
  const buildRun = await readBuildRun(paths);
  if (
    buildRun?.state === "running" &&
    !buildRun.waitingOnQuestions &&
    !isFollowedImplement(buildRun.pid) &&
    implementProcessGone(buildRun.pid)
  ) {
    await writeBuildRun(paths, {
      specHash: buildRun.specHash,
      state: "failed",
      adapter: buildRun.adapter,
      at: new Date().toISOString(),
      message: IMPLEMENT_INTERRUPTED,
    });
  }
  const latestBuildRun = await readBuildRun(paths);
  const build = evaluateBuild(result.spec, latestBuildRun);
  result.health.build = repo.implement
    ? {
        ...build,
        needsStack: needsStackChoice(repo),
        adapter: build.adapter,
      }
    : {
        state: "not_yet",
        owned: false,
        message: "Implement is off in req0.json. Build this repo another way. Prove uses fixtures/runtime.yaml.",
      };
  const runtime = await loadRuntime(paths);
  if (result.spec) {
    result.qaPlan = emitQaPlan(result.spec);
  }
  const proofRun = result.spec ? await readProofRun(paths) : null;
  const succeededAt =
    repo.implement && result.health.build.state === "succeeded" ? buildRun?.at : undefined;
  result.health.proof = evaluateProof({
    spec: result.spec,
    runtime: runtime.ok,
    run: proofRun,
    buildAt: succeededAt,
  });
  if (!runtime.ok && !runtime.missing) {
    result.health.proof.message = runtime.findings[0]?.message;
  }
  result.health = applyReadyToHealth(result.health, result.health.ready);
  await persistDerived(paths, result);
  return result;
}

export async function checkPack(paths: PackPaths, client?: JevClient): Promise<CompileResult> {
  const compiled = await compilePack(paths);
  if (!compiled.spec || !compiled.jevPack) return compiled;

  const resolved = client ?? resolveJevClient();
  try {
    const answers = await resolved.judge(compiled.jevPack);
    const run: JevRun = {
      specHash: specHash(compiled.spec),
      checkedAt: new Date().toISOString(),
      answers,
    };
    await mkdir(paths.derived, { recursive: true });
    await writeFile(paths.jevRun, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await clearImproveLog(paths);
    return compilePack(paths);
  } catch (err) {
    if (err instanceof JevUnavailableError) {
      return attachReady(compiled, {
        personas: await loadPersonas(paths),
        jevRun: null,
        hasApiKey: false,
      });
    }
    if (err instanceof JevRequestError) throw err;
    throw new JevRequestError(err instanceof Error ? err.message : "Jev request failed.");
  }
}

export function isPackWatchInput(filename: string): boolean {
  const relative = filename.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!relative || relative.split("/").includes("derived")) return false;
  const base = path.posix.basename(relative);
  return base === REQUIREMENT_FILE || base === path.posix.basename(PERSONAS_FILE) || base === path.posix.basename(RUNTIME_FILE);
}

export function shouldRefreshForWatch(watchPath: string, filename?: string | Buffer | null): boolean {
  const relative = typeof filename === "string" ? filename : Buffer.isBuffer(filename) ? filename.toString("utf8") : "";
  if (relative.trim()) return isPackWatchInput(relative);
  return isPackWatchInput(path.basename(watchPath));
}

export async function persistDerived(paths: PackPaths, result: CompileResult): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  if (result.spec) {
    await writeIfChanged(paths.spec, `${JSON.stringify(result.spec, null, 2)}\n`);
  }
  if (result.jevPack) {
    await writeIfChanged(paths.jevPack, `${JSON.stringify(result.jevPack, null, 2)}\n`);
  }
  if (result.implementBrief) {
    await writeIfChanged(paths.implementBrief, result.implementBrief);
  }
  if (result.qaPlan) {
    await writeIfChanged(paths.qaPlan, emitQaPlanYaml(result.qaPlan));
  }
  await writeIfChanged(paths.health, `${JSON.stringify(result.health, null, 2)}\n`);
  await writeIfChanged(paths.status, healthToStatusMarkdown(result.health));
}

async function writeIfChanged(file: string, contents: string): Promise<void> {
  try {
    if ((await readFile(file, "utf8")) === contents) return;
  } catch {
    // missing
  }
  await writeFile(file, contents, "utf8");
}

async function readJevRun(paths: PackPaths, spec: SpecAst): Promise<JevRun | null> {
  try {
    const raw = JSON.parse(await readFile(paths.jevRun, "utf8")) as JevRun;
    if (raw.specHash !== specHash(spec)) return null;
    if (!Array.isArray(raw.answers)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function createPack(root: string): Promise<PackPaths> {
  const paths = packPaths(root);
  await mkdir(path.join(root, "fixtures"), { recursive: true });
  await mkdir(path.join(root, "context"), { recursive: true });
  await mkdir(paths.derived, { recursive: true });
  try {
    await access(paths.requirement);
  } catch {
    await writeFile(paths.requirement, await loadStarterRequirement(), "utf8");
  }
  try {
    await access(paths.personas);
  } catch {
    await writeFile(paths.personas, PERSONAS_STUB, "utf8");
  }
  await writeRuntimeStubIfMissing(paths);
  await compilePack(paths);
  return paths;
}

export async function deletePack(paths: PackPaths): Promise<void> {
  if (!(await isPackDir(paths.root))) {
    throw new Error(`Not a requirement pack: ${paths.id}`);
  }
  await rm(paths.root, { recursive: true, force: true });
}

export async function writeRuntimeStubIfMissing(paths: PackPaths): Promise<boolean> {
  try {
    await access(paths.runtime);
    return false;
  } catch {
    await mkdir(path.dirname(paths.runtime), { recursive: true });
    await writeFile(paths.runtime, RUNTIME_STUB, "utf8");
    return true;
  }
}

async function readBuildRun(paths: PackPaths): Promise<BuildRun | null> {
  try {
    const raw = JSON.parse(await readFile(paths.buildRun, "utf8")) as BuildRun;
    if (typeof raw.specHash !== "string" || !raw.state) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function implementPack(
  paths: PackPaths,
  options: {
    adapter?: AdapterId;
    stack?: string;
    fromProof?: boolean;
    onLogLine?: (line: string) => void;
    extraPrompt?: string;
    resume?: boolean;
  } = {},
): Promise<{ result: CompileResult; message: string; launch?: LaunchAdapterResult }> {
  const compiled = await compilePack(paths);
  if (!options.resume && isOpenQuestions(await readAgentQuestions(paths))) {
    throw new AgentAnswersError("Answer the agent's questions, or Stop, before starting a new Implement.");
  }
  assertImplementAllowed(compiled);
  if (options.fromProof && !options.resume) {
    assertFixFromProofAllowed(compiled.health, compiled.health.ready);
    if (!compiled.spec) throw new FixFromProofLockedError();
  }
  const repo = await inspectProductRepo(paths.root);
  if (!repo.implement) throw new ImplementDisabledError();
  await writeRuntimeStubIfMissing(paths);
  const adapter = options.adapter ?? (repo.adapterRecorded ? repo.adapter : "cursor");
  const requested = options.stack !== undefined ? resolveStackId(options.stack) : null;
  if (options.stack !== undefined && !requested) throw new UnknownStackError(options.stack);
  const stack = requested ?? (repo.recorded ? repo.stack : null);
  if (!stack && needsStackChoice(repo)) throw new StackRequiredError();
  if (repo.root) {
    await writeReq0Config(repo.root, stack ? { adapter, stack } : { adapter });
    if (stack) await writeAmplifyEnvExampleIfMissing(repo.root, stack);
  }
  let briefPath = paths.implementBrief;
  let prompt = implementPrompt(paths.implementBrief, stack?.id ?? repo.stack.id);
  if (options.fromProof && compiled.spec) {
    const brief = emitFixFromProofBrief({
      spec: compiled.spec,
      proof: compiled.health.proof,
      reportPath: "derived/proof-report.md",
      implementBriefPath: "derived/implement-brief.md",
    });
    await mkdir(paths.derived, { recursive: true });
    await writeFile(paths.fixFromProofBrief, brief, "utf8");
    briefPath = paths.fixFromProofBrief;
    prompt = fixFromProofPrompt(paths.fixFromProofBrief, paths.proofReport, paths.implementBrief);
  }
  prompt = await withRememberedAnswers(paths, prompt);
  if (options.extraPrompt) prompt = `${prompt}\n\n${options.extraPrompt}`;
  const launch = await launchAdapter(adapter, repo.root, briefPath, {
    onLogLine: options.onLogLine,
    prompt,
  });
  const following = launch.ok && adapterLaunchesAgent(adapter) && Boolean(launch.finished);
  if (following) followImplementPid(launch.child?.pid);
  await writeBuildRun(paths, {
    specHash: compiled.spec ? specHash(compiled.spec) : "",
    state: !launch.ok ? "failed" : following ? "running" : "succeeded",
    adapter,
    at: new Date().toISOString(),
    message: launch.message,
    ...(following && launch.child?.pid ? { pid: launch.child.pid } : {}),
    ...(options.fromProof ? { fromProof: true } : {}),
  });
  return { result: await compilePack(paths), message: launch.message, launch };
}

export async function finishImplement(
  paths: PackPaths,
  launch: LaunchAdapterResult,
  adapter: AdapterId,
): Promise<{ result: CompileResult; message: string }> {
  const done = launch.finished ? await launch.finished : { code: launch.ok ? 0 : 1 };
  unfollowImplementPid(launch.child?.pid);
  const compiled = await compilePack(paths);
  const previous = await readBuildRun(paths);
  const stopped = launch.stop?.reason;
  const waiting = !stopped && isOpenQuestions(await readAgentQuestions(paths));
  if (waiting) {
    await writeBuildRun(paths, {
      specHash: compiled.spec ? specHash(compiled.spec) : previous?.specHash ?? "",
      state: "running",
      adapter,
      at: new Date().toISOString(),
      message: AGENT_QUESTIONS_WAITING,
      waitingOnQuestions: true,
      ...(previous?.fromProof ? { fromProof: true } : {}),
    });
    return { result: await compilePack(paths), message: AGENT_QUESTIONS_WAITING };
  }
  const ok = !stopped && launch.ok && done.code === 0;
  const name = adapterDisplayName(adapter);
  const message = stopped
    ? stopped
    : ok
      ? `${name} agent finished. Build Succeeded is not proof the app boots.`
      : `${name} agent exited (${done.code ?? "unknown"}). ${tailImplementLog(paths)}`.trim();
  await writeBuildRun(paths, {
    specHash: compiled.spec ? specHash(compiled.spec) : "",
    state: ok ? "succeeded" : "failed",
    adapter,
    at: new Date().toISOString(),
    message,
    ...(previous?.fromProof ? { fromProof: true } : {}),
  });
  return { result: await compilePack(paths), message };
}

export class StopImplementLockedError extends Error {
  readonly code = "stop_implement_gate";

  constructor(message = "Stop is only while Implement is running.") {
    super(message);
    this.name = "StopImplementLockedError";
  }
}

export async function stopImplement(
  paths: PackPaths,
  launch: LaunchAdapterResult | null,
  reason = IMPLEMENT_STOPPED,
): Promise<{ result: CompileResult; message: string }> {
  const waiting = isOpenQuestions(await readAgentQuestions(paths));
  if (!waiting && !launch?.child && !launch?.finished) {
    throw new StopImplementLockedError();
  }
  if (launch?.child || launch?.finished) {
    const stop = launch.stop ?? (launch.stop = {});
    requestImplementStop(launch.child, stop, reason);
  }
  await clearAgentQuestions(paths);
  const compiled = await compilePack(paths);
  const previous = await readBuildRun(paths);
  await writeBuildRun(paths, {
    specHash: compiled.spec ? specHash(compiled.spec) : "",
    state: "failed",
    adapter: previous?.adapter ?? "cursor",
    at: new Date().toISOString(),
    message: reason,
    ...(previous?.fromProof ? { fromProof: true } : {}),
  });
  return { result: await compilePack(paths), message: reason };
}

export async function ignoreBuild(
  paths: PackPaths,
  successful: boolean,
): Promise<{ result: CompileResult; message: string }> {
  const compiled = await compilePack(paths);
  if (!ignoreBuildAllowed(compiled.health)) {
    throw new IgnoreBuildLockedError();
  }
  const previous = await readBuildRun(paths);
  await writeBuildRun(paths, {
    specHash: compiled.spec ? specHash(compiled.spec) : previous?.specHash ?? "",
    state: successful ? "succeeded" : "failed",
    adapter: previous?.adapter ?? "cursor",
    at: new Date().toISOString(),
    message: successful
      ? "Owner marked Build successful after Ignore."
      : previous?.message ?? "Owner ignored this failed Build.",
    ignored: true,
  });
  const result = await compilePack(paths);
  return {
    result,
    message: successful
      ? "Build marked successful. Prove is unlocked."
      : "Build stays failed. Prove is unlocked.",
  };
}

async function writeBuildRun(paths: PackPaths, run: BuildRun): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.buildRun, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function tailImplementLog(paths: PackPaths): string {
  try {
    return readFileSync(path.join(paths.derived, "implement-agent.log"), "utf8")
      .trim()
      .split(/\r?\n/)
      .slice(-3)
      .join(" ")
      .slice(0, 280);
  } catch {
    return "";
  }
}

export async function writeImproveBrief(
  paths: PackPaths,
  compiled?: CompileResult | null,
): Promise<{ result: CompileResult; brief: string }> {
  if (isOpenQuestions(await readAgentQuestions(paths))) {
    throw new AgentAnswersError("Answer the agent's questions, or Stop, before starting a new Improve.");
  }
  const result = compiled ?? (await compilePack(paths));
  assertImproveAllowed(result.health.ready);
  const findings = improveFindings(result.health.ready);
  const brief = emitImproveBrief({
    spec: result.spec,
    ready: result.health.ready,
    findings,
  });
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.improveBrief, brief, "utf8");
  await beginImproveReview(paths);
  if (findings.length) await recordImprovePending(paths, findings);
  return { result, brief };
}

export async function launchImprove(
  paths: PackPaths,
  options: { adapter?: AdapterId; extraPrompt?: string } = {},
): Promise<LaunchAdapterResult> {
  const repo = await inspectProductRepo(paths.root);
  const adapter = options.adapter ?? (repo.adapterRecorded && adapterLaunchesAgent(repo.adapter) ? repo.adapter : "manual");
  const name = adapterDisplayName(adapter);
  const prompt = options.extraPrompt
    ? `${improvePrompt(paths.improveBrief)}\n\n${options.extraPrompt}`
    : improvePrompt(paths.improveBrief);
  return launchAdapter(adapter, repo.root, paths.improveBrief, {
    prompt,
    openIde: false,
    successMessage:
      adapter === "manual"
        ? "Wrote derived/improve-brief.md. Open it in any coding agent."
        : `Started a ${name} agent. The cockpit will show a diff when the spec changes.`,
  });
}

export async function answerAgentQuestions(
  paths: PackPaths,
  answers: Record<string, string>,
  options: { adapter?: AdapterId; onLogLine?: (line: string) => void } = {},
): Promise<{
  result: CompileResult;
  message: string;
  channel: "improve" | "implement";
  launch?: LaunchAdapterResult;
}> {
  const open = await readAgentQuestions(paths);
  if (!isOpenQuestions(open)) {
    throw new AgentAnswersError("No open questions to answer.");
  }
  const answered = applyAnswers(open, answers);
  await writeAgentQuestions(paths, answered);
  const extraPrompt = withOwnerAnswers("", answered).trim();
  if (answered.channel === "improve") {
    const launch = await launchImprove(paths, { adapter: options.adapter, extraPrompt });
    return {
      result: await compilePack(paths),
      message: launch.message,
      channel: "improve",
      launch: launch.ok && launch.finished ? launch : undefined,
    };
  }
  const previous = await readBuildRun(paths);
  const launched = await implementPack(paths, {
    adapter: options.adapter ?? previous?.adapter,
    fromProof: previous?.fromProof === true,
    onLogLine: options.onLogLine,
    resume: true,
  });
  return {
    result: launched.result,
    message: launched.message,
    channel: "implement",
    launch: launched.launch,
  };
}

export async function discardAgentQuestions(
  paths: PackPaths,
  launch: LaunchAdapterResult | null,
): Promise<{ result: CompileResult; message: string; channel: "improve" | "implement" }> {
  const open = await readAgentQuestions(paths);
  if (!isOpenQuestions(open)) {
    throw new AgentAnswersError("No open questions to discard.");
  }
  if (open.channel === "implement") {
    const stopped = await stopImplement(paths, launch);
    return { result: stopped.result, message: stopped.message, channel: "implement" };
  }
  await clearAgentQuestions(paths);
  if (await readImproveSnapshot(paths)) {
    await rejectImproveReview(paths);
  }
  return {
    result: await compilePack(paths),
    message: "Discarded the agent's questions.",
    channel: "improve",
  };
}

export async function improvePack(
  paths: PackPaths,
  options: { adapter?: AdapterId } = {},
): Promise<{ result: CompileResult; message: string; brief: string }> {
  const written = await writeImproveBrief(paths);
  const launch = await launchImprove(paths, options);
  return { result: written.result, message: launch.message, brief: written.brief };
}

export async function writeRequirement(paths: PackPaths, markdown: string): Promise<CompileResult> {
  if (await readImproveSnapshot(paths)) {
    throw new ImproveReviewPendingError();
  }
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.requirement, markdown, "utf8");
  return compilePack(paths);
}

export async function loadRuntime(paths: PackPaths): Promise<RuntimeResult> {
  try {
    const text = await readFile(paths.runtime, "utf8");
    if (!text.trim()) return { ok: false, missing: true };
    return parseRuntimeYaml(text);
  } catch {
    return { ok: false, missing: true };
  }
}

async function readProofRun(paths: PackPaths): Promise<ProofRun | null> {
  try {
    const raw = JSON.parse(await readFile(paths.proofRun, "utf8")) as ProofRun;
    if (!raw.specHash || !Array.isArray(raw.cases) || !raw.boot) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function provePack(
  paths: PackPaths,
  deps: {
    driver?: ProofDriver;
    client?: JevClient;
    waitForUrl?: (url: string) => Promise<boolean>;
    onProgress?: ProgressFn;
  } = {},
): Promise<{ result: CompileResult; message: string }> {
  const compiled = await compilePack(paths);
  assertProveAllowed(compiled);
  const runtime = await loadRuntime(paths);
  if (!runtime.ok || !compiled.spec || !compiled.qaPlan) {
    throw new ProveLockedError(
      "Prove is locked without fixtures/runtime.yaml (baseUrl and deterministic login).",
    );
  }
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.proveLog, "");
  let writing = Promise.resolve();
  const onProgress: ProgressFn = (message, level = "info") => {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    writing = writing.then(() => appendFile(paths.proveLog, line)).catch(() => {});
    deps.onProgress?.(message, level);
  };
  const personas = await loadPersonas(paths);
  const repo = await inspectProductRepo(paths.root);
  const buildRun = await readBuildRun(paths);
  const buildAt =
    compiled.health.build.owned !== false && compiled.health.build.state === "succeeded"
      ? buildRun?.at
      : undefined;
  const run = await provePlan(
    {
      spec: compiled.spec,
      plan: compiled.qaPlan,
      runtime: runtime.runtime,
      personas,
      productRoot: repo.root,
      buildAt,
    },
    { ...deps, onProgress },
  );
  await persistProofRun(
    paths,
    run,
    emitProofReport({
      spec: compiled.spec,
      plan: compiled.qaPlan,
      run,
      ready: compiled.health.ready,
      baseUrl: runtime.runtime.baseUrl,
    }),
  );
  onProgress("Wrote derived/proof-report.md.", "ok");
  const result = await compilePack(paths);
  const failed = run.cases.filter((item) => item.verdict === "fail").length;
  const review = run.cases.filter((item) => item.verdict === "review").length;
  const message = !run.boot.ok
    ? (run.boot.message ?? "Proof boot failed.")
    : failed
      ? `Proof failed (${failed} case${failed === 1 ? "" : "s"}).`
      : review
        ? `Proof needs review (${review} case${review === 1 ? "" : "s"}).`
        : `Proof passed (${run.cases.length} case${run.cases.length === 1 ? "" : "s"}).`;
  onProgress(message, !run.boot.ok || failed ? "error" : review ? "info" : "ok");
  await writing;
  return { result, message };
}
