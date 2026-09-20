import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { compileMarkdown, healthToStatusMarkdown, isRequirementId } from "./compile.js";
import { assertImplementAllowed, launchAdapter } from "./implement.js";
import { emitImplementBrief } from "./implement-brief.js";
import { hasJevAccess, JevRequestError, JevUnavailableError, resolveJevClient, type JevClient } from "./jev.js";
import { emitJevPack } from "./jev-pack.js";
import { parsePersonasYaml, type PersonasResult } from "./personas.js";
import { applyReadyToHealth, attachReady, evaluateBuild, specHash } from "./ready.js";
import { DEFAULT_STACK, inspectProductRepo, writeReq0Config } from "./stack.js";
import { EMPTY_TEMPLATE, PERSONAS_STUB } from "./template.js";
import type { AdapterId, BuildRun, CompileResult, JevRun, SpecAst } from "./types.js";

export const REQUIREMENT_FILE = "requirement.md";
export const PERSONAS_FILE = path.join("fixtures", "personas.yaml");

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
  buildRun: string;
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
    buildRun: path.join(derived, "build-run.json"),
  };
}

export async function isPackDir(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, REQUIREMENT_FILE));
    return true;
  } catch {
    return false;
  }
}

export async function resolvePack(cwd: string): Promise<PackPaths | null> {
  const abs = path.resolve(cwd);
  if (await isPackDir(abs)) return packPaths(abs);

  const id = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  if (isRequirementId(id) && parent === "requirements") {
    return packPaths(abs);
  }

  const named = path.join(abs, "docs", "requirements");
  const packs = await listPacks(named);
  if (packs.length === 1) return packs[0] ?? null;
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
  if (result.spec) {
    const repo = await inspectProductRepo(paths.root);
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
  const buildRun = await readBuildRun(paths);
  result.health.build = evaluateBuild(result.spec, buildRun);
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

export async function persistDerived(paths: PackPaths, result: CompileResult): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  if (result.spec) {
    await writeFile(paths.spec, `${JSON.stringify(result.spec, null, 2)}\n`, "utf8");
  }
  if (result.jevPack) {
    await writeFile(paths.jevPack, `${JSON.stringify(result.jevPack, null, 2)}\n`, "utf8");
  }
  if (result.implementBrief) {
    await writeFile(paths.implementBrief, result.implementBrief, "utf8");
  }
  await writeFile(paths.health, `${JSON.stringify(result.health, null, 2)}\n`, "utf8");
  await writeFile(paths.status, healthToStatusMarkdown(result.health), "utf8");
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
    await writeFile(paths.requirement, EMPTY_TEMPLATE, "utf8");
  }
  try {
    await access(paths.personas);
  } catch {
    await writeFile(paths.personas, PERSONAS_STUB, "utf8");
  }
  await compilePack(paths);
  return paths;
}

async function readBuildRun(paths: PackPaths): Promise<BuildRun | null> {
  try {
    const raw = JSON.parse(await readFile(paths.buildRun, "utf8")) as BuildRun;
    if (!raw.specHash || !raw.state) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function implementPack(
  paths: PackPaths,
  options: { adapter?: AdapterId } = {},
): Promise<{ result: CompileResult; message: string }> {
  const compiled = await compilePack(paths);
  assertImplementAllowed(compiled);
  const repo = await inspectProductRepo(paths.root);
  const adapter = options.adapter ?? "cursor";
  const stack = repo.recorded ? repo.stack : DEFAULT_STACK;
  if (repo.root) {
    await writeReq0Config(repo.root, { adapter, stack });
  }
  const launch = await launchAdapter(adapter, repo.root);
  const run: BuildRun = {
    specHash: compiled.spec ? specHash(compiled.spec) : "",
    state: launch.ok ? "succeeded" : "failed",
    adapter,
    at: new Date().toISOString(),
    message: launch.message,
  };
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.buildRun, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return { result: await compilePack(paths), message: launch.message };
}

export async function writeRequirement(paths: PackPaths, markdown: string): Promise<CompileResult> {
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.requirement, markdown, "utf8");
  return compilePack(paths);
}
