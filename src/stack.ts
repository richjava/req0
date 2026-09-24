import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterId, ProductRepo, Req0Config, StackChoice } from "./types.js";

export const REQ0_CONFIG_FILE = "req0.json";

export const DEFAULT_STACK: StackChoice = {
  id: "nextjs-default",
  label: "Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth",
};

const APP_MANIFESTS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "Cargo.toml",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
  "Gemfile",
  "composer.json",
];

export function findRepoRootFromPack(packRoot: string): string | null {
  let dir = path.resolve(packRoot);
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(dir);
    if (path.basename(dir) === "requirements" && path.basename(parent) === "docs") {
      return path.dirname(parent);
    }
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function readReq0Config(repoRoot: string): Promise<Req0Config | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(repoRoot, REQ0_CONFIG_FILE), "utf8")) as Req0Config;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export async function writeReq0Config(repoRoot: string, config: Req0Config): Promise<void> {
  const previous = await readReq0Config(repoRoot);
  const next = { ...previous, ...config };
  await writeFile(path.join(repoRoot, REQ0_CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function inspectProductRepo(packRoot: string): Promise<ProductRepo> {
  const root = findRepoRootFromPack(packRoot);
  if (!root) {
    return { root: null, empty: true, stack: DEFAULT_STACK, recorded: false, adapter: "manual", implement: true };
  }
  const config = await readReq0Config(root);
  const implement = config?.implement !== false;
  if (config?.stack) {
    return {
      root,
      empty: false,
      stack: config.stack,
      recorded: true,
      adapter: config.adapter === "cursor" ? "cursor" : "manual",
      implement,
    };
  }
  const empty = !(await hasCustomerApp(root));
  return {
    root,
    empty,
    stack: DEFAULT_STACK,
    recorded: false,
    adapter: config?.adapter === "cursor" ? "cursor" : "manual",
    implement,
  };
}

export async function hasCustomerApp(repoRoot: string): Promise<boolean> {
  for (const file of APP_MANIFESTS) {
    try {
      await access(path.join(repoRoot, file));
      return true;
    } catch {
      // keep looking
    }
  }
  try {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { name?: string };
    return pkg.name !== "req0";
  } catch {
    return false;
  }
}

export function stackInstruction(repo: ProductRepo, adapter: AdapterId): string {
  if (!repo.empty) {
    return [
      "This repo already has a product app. Implement in the existing stack.",
      "Do not scaffold a second application.",
      repo.recorded ? `Recorded stack: ${repo.stack.label}.` : "Match the repo you see.",
      `Adapter: ${adapter}.`,
    ].join(" ");
  }
  return [
    "This product repo is empty (no customer app at the repo root).",
    `Ask the Requirement Owner which stack to use. Default: ${DEFAULT_STACK.label}.`,
    "Record the choice in req0.json at the repo root so later requirements stay consistent.",
    "Req0's own CLI package.json does not count as a customer app.",
    `Adapter: ${adapter}.`,
  ].join(" ");
}
