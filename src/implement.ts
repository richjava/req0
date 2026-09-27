import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AdapterId, CompileResult } from "./types.js";

export const IMPLEMENT_AGENT_LOG = "implement-agent.log";
/** Hard cap on `ampx sandbox --once` starts in one Implement / Fix from proof run. */
export const IMPLEMENT_SANDBOX_MAX = 3;
/** Wall-clock cap so a debug loop cannot run indefinitely. */
export const IMPLEMENT_MAX_MS = 20 * 60 * 1000;
export const IMPLEMENT_STOPPED = "Owner stopped Implement.";
export const IMPLEMENT_SANDBOX_CAP = `Stopped after ${IMPLEMENT_SANDBOX_MAX} sandbox deploys. Rebuild or Ignore, then Prove.`;
export const IMPLEMENT_TIME_CAP = `Stopped after ${IMPLEMENT_MAX_MS / 60_000} minutes. Rebuild or Ignore, then Prove.`;

export type ImplementStop = { reason?: string };

export class ImplementLockedError extends Error {
  readonly code = "ready_gate";

  constructor(message = "Implement is locked until Ready is Ready. Check this spec with Jev first.") {
    super(message);
    this.name = "ImplementLockedError";
  }
}

export class ImplementDisabledError extends Error {
  readonly code = "implement_off";

  constructor(
    message = "Implement is off in req0.json. Build this repo another way, then Prove with fixtures/runtime.yaml.",
  ) {
    super(message);
    this.name = "ImplementDisabledError";
  }
}

export type LaunchAdapterDeps = {
  spawn?: typeof spawn;
  resolveBin?: () => string | null;
  agentStatus?: (bin: string) => string;
  settleMs?: number;
  platform?: NodeJS.Platform;
  prompt?: string;
  successMessage?: string;
  openIde?: boolean;
  logFile?: string;
  onLogLine?: (line: string) => void;
  sandboxMax?: number;
  maxMs?: number;
};

export type LaunchAdapterResult = {
  ok: boolean;
  message: string;
  child?: ChildProcess;
  logPath?: string;
  finished?: Promise<{ code: number | null }>;
  stop?: ImplementStop;
};

export function adapterInstructions(adapter: AdapterId, briefPath: string): string {
  if (adapter === "cursor") {
    return `Cursor adapter: agent starts in the product repo with ${briefPath} in the prompt. Do not invent spec IDs.`;
  }
  return `Manual adapter: open ${briefPath} in any coding agent and implement from that brief. This path does not start an agent.`;
}

export function implementPrompt(briefPath: string, stackId?: string): string {
  const amplify =
    stackId === "amplify-gen2"
      ? " If the stack is amplify-gen2: ampx does not read .env. If there is no AWS_PROFILE, inherited AWS_ACCESS_KEY_ID, or ~/.aws, stop and tell the owner to run npx ampx configure profile. Do not ask for keys. After scaffolding amplify/, run npx ampx sandbox --once (add --profile when using a profile) and wait until amplify_outputs.json has a real user_pool_id, not REPLACE_VIA_SANDBOX. Restart the app, then seed personas. npm install is not a sandbox deploy."
      : "";
  return [
    "Implement this requirement from the brief.",
    `Read ${briefPath} and derived/spec.json.`,
    "Do not invent spec IDs. Implement only the named BR- and UC- IDs.",
    "If this product repo has no customer app, use the stack recorded in req0.json.",
    "Seed the app from existing fixtures/personas.yaml. Do not invent personas.",
    "Finish fixtures/runtime.yaml so baseUrl, startCommand, and resetCommand match the app. Keep login selectors unless you change /login to match.",
    "Write product .env.example with variable names only. No real keys.",
    "Write product README.md using the requirement title and pack fixture paths. Do not invent a product name.",
    "Do not treat this launch as proof the app boots.",
    `At most ${IMPLEMENT_SANDBOX_MAX} npx ampx sandbox --once deploys in this run. After the third, stop and tell the owner what is still failing. Do not start a fourth.`,
  ]
    .join(" ")
    .concat(amplify);
}

export function fixFromProofPrompt(briefPath: string, reportPath: string, implementBriefPath: string): string {
  return [
    "Fix the existing product from the last Prove.",
    `Read ${briefPath}, then ${reportPath}, then ${implementBriefPath}.`,
    "Close only the Failed and Needs review cases. Do not invent spec IDs.",
    "Do not edit requirement.md. Do not scaffold a second application.",
    "Boot or Sign-in observations may be fixtures or runtime.yaml, not a missing control.",
    "Do not treat this launch as proof the app boots.",
    `At most ${IMPLEMENT_SANDBOX_MAX} npx ampx sandbox --once deploys in this run. After the third, stop and tell the owner what is still failing. Do not start a fourth.`,
  ].join(" ");
}

export function improvePrompt(briefPath: string): string {
  return [
    "Improve this requirement pack from the brief.",
    `Read ${briefPath} and requirement.md.`,
    "Patch requirement.md only. If the brief asks for a persona, you may also edit fixtures/personas.yaml.",
    "Outcome is what a person sees. Do not paste matrix allow/deny cells into Outcome. Look for is deny; Choose is allow.",
    "Do not invent spec IDs. Do not implement the product app.",
    "Stop after the patch so the owner can review the diff, then Check with Jev.",
  ].join(" ");
}

export function resolveCursorBin(): string | null {
  const override = process.env.CURSOR_BIN?.trim();
  if (override && existsSync(override)) return override;
  const exe = process.platform === "win32" ? "cursor.cmd" : "cursor";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  const mac = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  if (process.platform === "darwin" && existsSync(mac)) return mac;
  return null;
}

export function cursorAgentStatus(bin: string): string {
  const result = spawnSync(bin, ["agent", "status"], { encoding: "utf8", timeout: 4_000 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function assertImplementAllowed(result: CompileResult): void {
  if (result.health.ready.state !== "ready") {
    throw new ImplementLockedError();
  }
}

export function implementLogPath(briefPath: string, logFile = IMPLEMENT_AGENT_LOG): string {
  return path.join(path.dirname(briefPath), logFile);
}

export function launchAdapter(
  adapter: AdapterId,
  repoRoot: string | null,
  briefPath: string,
  deps: LaunchAdapterDeps = {},
): Promise<LaunchAdapterResult> {
  if (adapter === "manual") {
    return Promise.resolve({
      ok: true,
      message:
        deps.successMessage ??
        "Manual adapter does not start an agent. Open the brief, or run implement without --adapter=manual to launch Cursor. Build Succeeded is not proof the app boots.",
    });
  }
  if (!repoRoot) {
    return Promise.resolve({
      ok: false,
      message: "No product repo root, so Cursor cannot be launched. Use the manual adapter.",
    });
  }
  const bin = (deps.resolveBin ?? resolveCursorBin)();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      message:
        "Cursor was not found. Install Cursor, or set CURSOR_BIN, or retry with --adapter=manual.",
    });
  }
  if (!process.env.CURSOR_API_KEY && deps.agentStatus) {
    const status = deps.agentStatus(bin);
    if (/not logged in/i.test(status)) {
      return Promise.resolve({
        ok: false,
        message:
          `Cursor agent is not logged in, so nothing was generated. In a terminal run: "${bin}" agent login   then retry Implement.`,
      });
    }
  }
  const run = deps.spawn ?? spawn;
  return spawnCursorAgent(run, bin, repoRoot, briefPath, deps);
}

async function spawnCursorAgent(
  run: typeof spawn,
  bin: string,
  repoRoot: string,
  briefPath: string,
  deps: LaunchAdapterDeps,
): Promise<LaunchAdapterResult> {
  const platform = deps.platform ?? process.platform;
  const ide =
    deps.openIde === false
      ? Promise.resolve({ ok: true, message: "skipped" })
      : platform === "darwin"
        ? launchDetached(run, "open", ["-a", "Cursor", repoRoot], repoRoot)
        : launchDetached(run, bin, [repoRoot], repoRoot);

  const logPath = implementLogPath(briefPath, deps.logFile);
  const agent = launchLogged(run, bin, agentArgs(repoRoot, briefPath, deps), repoRoot, logPath, deps);

  const [, agentLaunch] = await Promise.all([ide, agent]);
  if (!agentLaunch.ok) {
    return { ok: false, message: agentLaunch.message, logPath, stop: agentLaunch.stop };
  }

  const settled = await waitForAgent(agentLaunch.child, deps.settleMs ?? 1500, logPath, bin);
  if (!settled.ok) {
    return {
      ...settled,
      logPath,
      child: agentLaunch.child,
      finished: agentLaunch.finished,
      stop: agentLaunch.stop,
    };
  }

  return {
    ok: true,
    message:
      deps.successMessage ??
      "Started a Cursor agent with the implement brief. Activity shows tools and messages as they happen. Build stays running until the agent exits.",
    child: agentLaunch.child,
    logPath,
    finished: agentLaunch.finished,
    stop: agentLaunch.stop,
  };
}

function agentArgs(repoRoot: string, briefPath: string, deps: LaunchAdapterDeps): string[] {
  const prompt = deps.prompt ?? implementPrompt(briefPath);
  const args = [
    "agent",
    "--workspace",
    repoRoot,
    "--trust",
    "--force",
    "--print",
    "--output-format",
    "stream-json",
    prompt,
  ];
  const key = process.env.CURSOR_API_KEY?.trim();
  if (key) args.splice(1, 0, "--api-key", key);
  return args;
}

function launchDetached(
  run: typeof spawn,
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; message: string; child?: ChildProcess }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = run(bin, args, { cwd, detached: true, stdio: "ignore", env: process.env });
    } catch (err) {
      resolve({
        ok: false,
        message: err instanceof Error ? err.message : "Cursor launch failed.",
      });
      return;
    }
    child.once("error", (err) => {
      resolve({
        ok: false,
        message: err.message.includes("ENOENT")
          ? "Cursor CLI was not found. Install it, set CURSOR_BIN, or retry with --adapter=manual."
          : err.message,
      });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, message: "started", child });
    });
  });
}

function launchLogged(
  run: typeof spawn,
  bin: string,
  args: string[],
  cwd: string,
  logPath: string,
  deps: LaunchAdapterDeps,
): Promise<{
  ok: boolean;
  message: string;
  child?: ChildProcess;
  finished?: Promise<{ code: number | null }>;
  stop?: ImplementStop;
}> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      mkdirSync(path.dirname(logPath), { recursive: true });
      child = run(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    } catch (err) {
      resolve({
        ok: false,
        message: err instanceof Error ? err.message : "Cursor launch failed.",
      });
      return;
    }
    const stop: ImplementStop = {};
    const finished = attachAgentLog(child, logPath, deps.onLogLine, {
      stop,
      sandboxMax: deps.sandboxMax ?? IMPLEMENT_SANDBOX_MAX,
      maxMs: deps.maxMs ?? IMPLEMENT_MAX_MS,
    });
    child.once("error", (err) => {
      resolve({
        ok: false,
        message: err.message.includes("ENOENT")
          ? "Cursor CLI was not found. Install it, set CURSOR_BIN, or retry with --adapter=manual."
          : err.message,
        finished,
        stop,
      });
    });
    child.once("spawn", () => {
      resolve({ ok: true, message: "started", child, finished, stop });
    });
  });
}

export function attachAgentLog(
  child: ChildProcess,
  logPath: string,
  onLogLine?: (line: string) => void,
  control: { stop?: ImplementStop; sandboxMax?: number; maxMs?: number } = {},
): Promise<{ code: number | null }> {
  const stream = createWriteStream(logPath, { flags: "w" });
  const stop = control.stop ?? {};
  const sandboxMax = control.sandboxMax ?? IMPLEMENT_SANDBOX_MAX;
  const maxMs = control.maxMs ?? IMPLEMENT_MAX_MS;
  let lastEmit = Date.now();
  let lastShown = "";
  let sandboxStarts = 0;
  const feed = makeLineFeeder((line) => {
    if (isSandboxOnceStart(line)) {
      sandboxStarts += 1;
      if (sandboxStarts > sandboxMax) {
        requestImplementStop(child, stop, IMPLEMENT_SANDBOX_CAP);
        if (IMPLEMENT_SANDBOX_CAP !== lastShown) {
          lastShown = IMPLEMENT_SANDBOX_CAP;
          lastEmit = Date.now();
          onLogLine?.(IMPLEMENT_SANDBOX_CAP);
        }
        return;
      }
    }
    const text = summarizeAgentLine(redactSecrets(line));
    if (!text || text === lastShown) return;
    lastShown = text;
    lastEmit = Date.now();
    onLogLine?.(text);
  });
  const heartbeat = onLogLine
    ? setInterval(() => {
        if (Date.now() - lastEmit < 20_000) return;
        lastEmit = Date.now();
        lastShown = "Cursor agent still running.";
        onLogLine(lastShown);
      }, 5_000)
    : undefined;
  heartbeat?.unref?.();
  const deadline =
    maxMs > 0
      ? setTimeout(() => {
          requestImplementStop(child, stop, IMPLEMENT_TIME_CAP);
          if (IMPLEMENT_TIME_CAP !== lastShown) {
            lastShown = IMPLEMENT_TIME_CAP;
            lastEmit = Date.now();
            onLogLine?.(IMPLEMENT_TIME_CAP);
          }
        }, maxMs)
      : undefined;
  deadline?.unref?.();
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stream.write(chunk);
    feed(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stream.write(chunk);
    feed(chunk);
  });
  return new Promise((resolve) => {
    child.once("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
      feed("\n");
      stream.end();
      resolve({ code });
    });
  });
}

export function requestImplementStop(
  child: ChildProcess | undefined,
  stop: ImplementStop,
  reason: string,
): void {
  if (stop.reason) return;
  stop.reason = reason;
  killImplementTree(child);
}

export function killImplementTree(child?: ChildProcess): void {
  const pid = child?.pid;
  try {
    child?.kill("SIGTERM");
  } catch {
    // already gone
  }
  if (typeof pid !== "number" || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  try {
    spawnSync("pkill", ["-TERM", "-P", String(pid)], { timeout: 2_000 });
  } catch {
    // no pkill, or no children
  }
}

export function isSandboxOnceStart(line: string): boolean {
  const text = line.trim();
  if (!text.includes("sandbox") || !text.includes("--once")) return false;
  if (!text.startsWith("{")) return /ampx sandbox --once/.test(text);
  try {
    const event = JSON.parse(text) as Record<string, unknown>;
    if (event.type !== "tool_call" || event.subtype !== "started") return false;
    return text.includes("ampx sandbox") && text.includes("--once");
  } catch {
    return false;
  }
}

export function summarizeAgentLine(line: string): string | null {
  const text = line.trim();
  if (!text) return null;
  if (!text.startsWith("{")) return text.slice(0, 280);
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text.slice(0, 280);
  }
  if (event.type === "system" && event.subtype === "init") {
    const model = typeof event.model === "string" && event.model.trim() ? event.model.trim() : "Cursor";
    return `Cursor agent connected (${model}).`;
  }
  if (event.type === "user") return null;
  if (event.type === "assistant") {
    const body = assistantText(event);
    return body ? clip(`Agent: ${body}`, 280) : null;
  }
  if (event.type === "tool_call") {
    if (event.subtype !== "started") return null;
    return summarizeToolStart(event.tool_call);
  }
  if (event.type === "result") {
    const ms = typeof event.duration_ms === "number" ? event.duration_ms : 0;
    const failed = event.is_error === true || event.subtype === "error";
    return failed
      ? `Cursor agent reported an error after ${formatDuration(ms)}.`
      : `Cursor agent finished in ${formatDuration(ms)}.`;
  }
  return null;
}

function assistantText(event: Record<string, unknown>): string {
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeToolStart(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const record = toolCall as Record<string, { args?: Record<string, unknown> }>;
  if (record.readToolCall) return clip(`Reading ${toolArg(record.readToolCall.args, "path")}`, 280);
  if (record.writeToolCall) return clip(`Writing ${toolArg(record.writeToolCall.args, "path")}`, 280);
  if (record.editToolCall) return clip(`Editing ${toolArg(record.editToolCall.args, "path")}`, 280);
  if (record.deleteToolCall) return clip(`Deleting ${toolArg(record.deleteToolCall.args, "path")}`, 280);
  if (record.shellToolCall) return clip(`Running ${toolArg(record.shellToolCall.args, "command")}`, 280);
  if (record.grepToolCall) return clip(`Searching ${toolArg(record.grepToolCall.args, "pattern")}`, 280);
  if (record.lsToolCall) return clip(`Listing ${toolArg(record.lsToolCall.args, "path")}`, 280);
  if (record.globToolCall) return clip(`Finding ${toolArg(record.globToolCall.args, "glob_pattern") || toolArg(record.globToolCall.args, "pattern")}`, 280);
  const fn = record.function;
  if (fn?.args && typeof fn.args.name === "string") return clip(`Using ${fn.args.name}`, 280);
  const key = Object.keys(record).find((name) => name.endsWith("ToolCall"));
  return key ? clip(`Using ${key.replace(/ToolCall$/, "")}`, 280) : "Using a tool.";
}

function toolArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) return "…";
  return value.replace(/\s+/g, " ").trim();
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function makeLineFeeder(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let pending = "";
  return (chunk) => {
    pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (text) onLine(text.slice(0, 280));
    }
  };
}

function redactSecrets(line: string): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (key && line.includes(key)) return line.split(key).join("…");
  return line;
}

async function waitForAgent(
  child: ChildProcess | undefined,
  settleMs: number,
  logPath: string,
  bin: string,
): Promise<{ ok: boolean; message: string }> {
  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  if (!child || child.exitCode === null || child.exitCode === undefined) {
    return { ok: true, message: "started" };
  }
  const tail = tailLog(logPath);
  return {
    ok: false,
    message: tail
      ? `Cursor agent exited immediately (${child.exitCode}). ${tail}`
      : `Cursor agent exited immediately (${child.exitCode}). If you are not logged in, run: "${bin}" agent login`,
  };
}

function tailLog(logPath: string): string {
  try {
    const text = readFileSync(logPath, "utf8").trim().split(/\r?\n/).slice(-4).join(" ");
    return text.slice(0, 280);
  } catch {
    return "";
  }
}
