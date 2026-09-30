#!/usr/bin/env node
import { watch } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { parseAdapterId } from "./adapter.js";
import { isRequirementId } from "./compile.js";
import { adapterInstructions, ImplementDisabledError, ImplementLockedError } from "./implement.js";
import { FixFromProofLockedError } from "./fix-from-proof.js";
import { StackRequiredError, UnknownStackError } from "./stack.js";
import { checkPack, compilePack, createPack, findRequirementsDir, finishImplement, implementPack, provePack, resolveCockpitPack, resolvePack, shouldRefreshForWatch } from "./pack.js";
import { ProveLockedError } from "./proof.js";
import { createAppState, createCockpitServer, refresh } from "./server.js";

loadProjectEnv();

const args = process.argv.slice(2);
const command = args[0] ?? "start";

try {
  await main(command, args.slice(1));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

function loadProjectEnv(): void {
  const starts = [process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")];
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      try {
        loadEnvFile(path.join(dir, ".env"));
      } catch {
        // missing .env is fine; keep walking
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

async function main(command: string, rest: string[]): Promise<void> {
  const cwd = process.cwd();

  if (command === "compile") {
    const pack = await resolvePack(cwd);
    if (!pack) {
      throw new Error("No requirement pack here. Open a docs/requirements/<id> folder, or create one.");
    }
    const result = await compilePack(pack);
    const errors = result.health.spec.findings.filter((f) => f.severity === "error");
    for (const f of result.health.spec.findings) {
      console.error(`${pack.id}:${f.line} ${f.severity}: ${f.message}`);
    }
    console.log(`Spec ${result.health.spec.state} · Ready ${result.health.ready.state} — ${result.health.howThisIsGoing}`);
    if (errors.length) process.exit(2);
    return;
  }

  if (command === "check") {
    const pack = await resolvePack(cwd);
    if (!pack) {
      throw new Error("No requirement pack here. Open a docs/requirements/<id> folder, or create one.");
    }
    const result = await checkPack(pack);
    console.log(`Ready ${result.health.ready.state} — ${result.health.howThisIsGoing}`);
    for (const finding of result.health.ready.findings) {
      console.error(`${finding.severity}: ${finding.message}`);
    }
    if (result.health.ready.reason === "no_api_key") process.exit(3);
    if (result.health.ready.state === "blocked") process.exit(2);
    return;
  }

  if (command === "implement") {
    const pack = await resolvePack(cwd);
    if (!pack) {
      throw new Error("No requirement pack here. Open a docs/requirements/<id> folder, or create one.");
    }
    const adapter = adapterFromArgs(rest);
    const stack = flagValue(rest, "stack");
    const fromProof = rest.includes("--from-proof");
    try {
      const launched = await implementPack(pack, {
        ...(adapter ? { adapter } : {}),
        ...(stack ? { stack } : {}),
        ...(fromProof ? { fromProof: true } : {}),
        onLogLine: (line) => console.log(line),
      });
      let result = launched.result;
      let message = launched.message;
      const used = adapter ?? result.health.build.adapter ?? "cursor";
      if (launched.launch?.finished) {
        console.log(`Build running — ${message}`);
        const done = await finishImplement(pack, launched.launch, used);
        result = done.result;
        message = done.message;
      }
      console.log(`Build ${result.health.build.state} — ${message}`);
      console.log(adapterInstructions(used, fromProof ? pack.fixFromProofBrief : pack.implementBrief));
      if (result.health.build.state === "failed") process.exit(2);
    } catch (err) {
      if (
        err instanceof ImplementLockedError ||
        err instanceof ImplementDisabledError ||
        err instanceof FixFromProofLockedError ||
        err instanceof StackRequiredError ||
        err instanceof UnknownStackError
      ) {
        console.error(err.message);
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  if (command === "prove") {
    const pack = await resolvePack(cwd);
    if (!pack) {
      throw new Error("No requirement pack here. Open a docs/requirements/<id> folder, or create one.");
    }
    try {
      const proved = await provePack(pack, {
        onProgress: (message, level) => {
          if (level === "error") console.error(message);
          else console.log(message);
        },
      });
      console.log(`${proved.message} — Proof ${proved.result.health.proof.state}`);
      for (const finding of proved.result.health.proof.findings) {
        console.error(`${finding.severity}: ${finding.message}`);
      }
      if (proved.result.health.proof.state === "failed") process.exit(2);
    } catch (err) {
      if (err instanceof ProveLockedError) {
        console.error(err.message);
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  if (command === "create") {
    const id = rest[0];
    if (id) {
      const requirementsDir =
        (await findRequirementsDir(cwd)) ?? path.join(cwd, "docs", "requirements");
      const created = await createPack(path.join(requirementsDir, id));
      console.log(`Created ${created.root}`);
      return;
    }
    if (isRequirementId(path.basename(cwd))) {
      const created = await createPack(cwd);
      console.log(`Created ${created.root}`);
      return;
    }
    throw new Error("Usage: req0 create <kebab-id>   or run inside an empty pack folder.");
  }

  if (command === "start") {
    await startCockpit(cwd);
    return;
  }

  throw new Error(
    `Unknown command "${command}". Try: req0 start | req0 create | req0 compile | req0 check | req0 implement | req0 prove`,
  );
}

async function startCockpit(cwd: string): Promise<void> {
  const pack = await resolveCockpitPack(cwd);
  const state = createAppState(cwd, pack);
  await refresh(state);

  const port = await pickPort(4370);
  const server = createCockpitServer(state);
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Req0 cockpit: ${url}`);
    if (state.pack) console.log(`Pack: ${state.pack.root}`);
    else console.log("Requirement list. Open a pack or create one from the cockpit.");
    openBrowser(url);
  });

  const requirementsDir = await findRequirementsDir(cwd);
  const watchTargets = requirementsDir
    ? [requirementsDir]
    : state.pack
      ? [state.pack.requirement, path.dirname(state.pack.personas)]
      : [];
  if (watchTargets.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!state.pack) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void refresh(state).catch((err) => {
        console.error(err instanceof Error ? err.message : err);
      });
    }, 80);
  };
  for (const watchPath of watchTargets) {
    try {
      const watcher = watch(watchPath, { recursive: Boolean(requirementsDir) }, (_event, filename) => {
        if (!shouldRefreshForWatch(watchPath, filename)) return;
        schedule();
      });
      watcher.on("error", (err) => {
        console.error(`File watch unavailable (${err.message}). Save from the cockpit still compiles.`);
      });
    } catch (err) {
      console.error(
        `File watch unavailable (${err instanceof Error ? err.message : err}). Save from the cockpit still compiles.`,
      );
    }
  }
}

async function pickPort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const free = await isFree(port);
    if (free) return port;
  }
  throw new Error("No free port near 4370.");
}

function flagValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

function adapterFromArgs(args: string[]): ReturnType<typeof parseAdapterId> {
  const flagged = flagValue(args, "adapter");
  if (flagged !== undefined) {
    const id = parseAdapterId(flagged);
    if (!id) throw new Error(`Unknown adapter "${flagged}". Use cursor, copilot, or manual.`);
    return id;
  }
  if (args[0] === "manual" || args[0] === "cursor" || args[0] === "copilot") return args[0];
  return null;
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", url] : [url];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.log("Open that URL in your browser.");
  }
}
