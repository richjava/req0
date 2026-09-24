import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AdapterId, CompileResult } from "./types.js";

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
};

export function adapterInstructions(adapter: AdapterId, briefPath: string): string {
  if (adapter === "cursor") {
    return `Cursor adapter: agent starts in the product repo with ${briefPath} in the prompt. Do not invent spec IDs.`;
  }
  return `Manual adapter: open ${briefPath} in any coding agent and implement from that brief. This path does not start an agent.`;
}

export function implementPrompt(briefPath: string): string {
  return [
    "Implement this requirement from the brief.",
    `Read ${briefPath} and derived/spec.json.`,
    "Do not invent spec IDs. Implement only the named BR- and UC- IDs.",
    "If this product repo has no customer app, use the stack recorded in req0.json.",
    "Do not treat this launch as proof the app boots.",
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

export function launchAdapter(
  adapter: AdapterId,
  repoRoot: string | null,
  briefPath: string,
  deps: LaunchAdapterDeps = {},
): Promise<{ ok: boolean; message: string }> {
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
): Promise<{ ok: boolean; message: string }> {
  const platform = deps.platform ?? process.platform;
  const ide =
    deps.openIde === false
      ? Promise.resolve({ ok: true, message: "skipped" })
      : platform === "darwin"
        ? launchDetached(run, "open", ["-a", "Cursor", repoRoot], repoRoot)
        : launchDetached(run, bin, [repoRoot], repoRoot);

  const logPath = path.join(path.dirname(briefPath), "implement-agent.log");
  const agent = launchDetached(
    run,
    bin,
    agentArgs(repoRoot, briefPath, deps),
    repoRoot,
    logPath,
  );

  const [, agentLaunch] = await Promise.all([ide, agent]);
  if (!agentLaunch.ok) {
    return { ok: false, message: agentLaunch.message };
  }

  const settled = await waitForAgent(agentLaunch.child, deps.settleMs ?? 1500, logPath, bin);
  if (!settled.ok) return settled;

  return {
    ok: true,
    message:
      deps.successMessage ??
      "Started a Cursor agent with the implement brief. Watch the product repo for new files. Build Succeeded is not proof the app boots.",
  };
}

function agentArgs(repoRoot: string, briefPath: string, deps: LaunchAdapterDeps): string[] {
  const prompt = deps.prompt ?? implementPrompt(briefPath);
  const args = ["agent", "--workspace", repoRoot, "--trust", "--force", "--print", prompt];
  const key = process.env.CURSOR_API_KEY?.trim();
  if (key) args.splice(1, 0, "--api-key", key);
  return args;
}

function launchDetached(
  run: typeof spawn,
  bin: string,
  args: string[],
  cwd: string,
  logPath?: string,
): Promise<{ ok: boolean; message: string; child?: ChildProcess }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    let logFd: number | undefined;
    try {
      const stdio: import("node:child_process").StdioOptions = ["ignore", "ignore", "ignore"];
      if (logPath) {
        mkdirSync(path.dirname(logPath), { recursive: true });
        logFd = openSync(logPath, "w");
        stdio[1] = logFd;
        stdio[2] = logFd;
      }
      child = run(bin, args, { cwd, detached: true, stdio, env: process.env });
    } catch (err) {
      if (logFd !== undefined) closeSync(logFd);
      resolve({
        ok: false,
        message: err instanceof Error ? err.message : "Cursor launch failed.",
      });
      return;
    }
    child.once("error", (err) => {
      if (logFd !== undefined) closeSync(logFd);
      resolve({
        ok: false,
        message: err.message.includes("ENOENT")
          ? "Cursor CLI was not found. Install it, set CURSOR_BIN, or retry with --adapter=manual."
          : err.message,
      });
    });
    child.once("spawn", () => {
      if (logFd !== undefined) closeSync(logFd);
      child.unref();
      resolve({ ok: true, message: "started", child });
    });
  });
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
