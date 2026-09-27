import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterId, ProductRepo, Req0Config, StackChoice } from "./types.js";

export const REQ0_CONFIG_FILE = "req0.json";
export const ENV_EXAMPLE_FILE = ".env.example";

export const AMPLIFY_ENV_EXAMPLE = `# Copy to .env. Names only. Do not put real values in this file.
# ampx does not read this file. Export the vars, or run: npx ampx configure profile
AWS_REGION=
# Named profile (then: npx ampx sandbox --once --profile <name>):
AWS_PROFILE=
# Or access keys instead of AWS_PROFILE:
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_SESSION_TOKEN=   # temporary/SSO creds only — not IAM user keys
`;

export const DEFAULT_STACK: StackChoice = {
  id: "nextjs-default",
  label: "Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth",
};

export const AMPLIFY_IDENTITY_HINT =
  "ampx reads AWS_PROFILE, inherited AWS_ACCESS_KEY_ID, or ~/.aws — not the .env file. If none of those exist, stop and tell the owner to run npx ampx configure profile. Do not ask for keys. Do not print env values.";

export const AMPLIFY_GEN2_STACK: StackChoice = {
  id: "amplify-gen2",
  label: "Amplify Gen 2, Next.js, Cognito, Data, S3",
};

export const KNOWN_STACKS: StackChoice[] = [DEFAULT_STACK, AMPLIFY_GEN2_STACK];

export const STACK_CHOICE_HINT =
  `Choose a stack before Implement. Write it in req0.json, pass --stack=${DEFAULT_STACK.id} or --stack=${AMPLIFY_GEN2_STACK.id}, or pick one in the cockpit.`;

export function isAmplifyStack(stack: StackChoice): boolean {
  return stack.id === AMPLIFY_GEN2_STACK.id;
}

export function resolveStackId(id: string): StackChoice | null {
  const trimmed = id.trim();
  return KNOWN_STACKS.find((stack) => stack.id === trimmed) ?? null;
}

export function needsStackChoice(repo: ProductRepo): boolean {
  return Boolean(repo.root) && repo.implement && repo.empty && !repo.recorded;
}

export class StackRequiredError extends Error {
  readonly code = "stack_required";

  constructor(message = STACK_CHOICE_HINT) {
    super(message);
    this.name = "StackRequiredError";
  }
}

export class UnknownStackError extends Error {
  readonly code = "unknown_stack";

  constructor(id: string) {
    super(`Unknown stack "${id}". Use ${DEFAULT_STACK.id} or ${AMPLIFY_GEN2_STACK.id}.`);
    this.name = "UnknownStackError";
  }
}

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
  const empty = !(await hasCustomerApp(root));
  const recorded = resolveRecordedStack(config?.stack);
  if (recorded) {
    return {
      root,
      empty,
      stack: recorded,
      recorded: true,
      adapter: config?.adapter === "cursor" ? "cursor" : "manual",
      implement,
    };
  }
  return {
    root,
    empty,
    stack: DEFAULT_STACK,
    recorded: false,
    adapter: config?.adapter === "cursor" ? "cursor" : "manual",
    implement,
  };
}

function resolveRecordedStack(raw: StackChoice | undefined): StackChoice | null {
  if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return null;
  return resolveStackId(raw.id) ?? (typeof raw.label === "string" && raw.label.trim() ? raw : null);
}

export async function recordStack(repoRoot: string, id: string): Promise<StackChoice> {
  const stack = resolveStackId(id);
  if (!stack) throw new UnknownStackError(id);
  await writeReq0Config(repoRoot, { stack });
  await writeAmplifyEnvExampleIfMissing(repoRoot, stack);
  return stack;
}

export async function writeAmplifyEnvExampleIfMissing(
  repoRoot: string,
  stack: StackChoice,
): Promise<boolean> {
  if (!isAmplifyStack(stack)) return false;
  const target = path.join(repoRoot, ENV_EXAMPLE_FILE);
  try {
    await access(target);
    return false;
  } catch {
    await writeFile(target, AMPLIFY_ENV_EXAMPLE, "utf8");
    return true;
  }
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
    const recorded = repo.recorded ? `Recorded stack: ${repo.stack.label}.` : "Match the repo you see.";
    const aws = isAmplifyStack(repo.stack) ? ` ${AMPLIFY_IDENTITY_HINT}` : "";
    return [
      "This repo already has a product app. Implement in the existing stack.",
      "Do not scaffold a second application.",
      recorded + aws,
      `Adapter: ${adapter}.`,
    ].join(" ");
  }
  if (repo.recorded) {
    const aws = isAmplifyStack(repo.stack) ? AMPLIFY_IDENTITY_HINT : "";
    return [
      "This product repo is empty (no customer app at the repo root).",
      `Recorded stack: ${repo.stack.label}. Use it. Do not ask for another stack.`,
      aws,
      "Req0's own CLI package.json does not count as a customer app.",
      `Adapter: ${adapter}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "This product repo is empty (no customer app at the repo root).",
    `Ask the Requirement Owner which stack to use. Default: ${DEFAULT_STACK.label}. AWS option: ${AMPLIFY_GEN2_STACK.label} (id ${AMPLIFY_GEN2_STACK.id}).`,
    "Record the choice in req0.json at the repo root so later requirements stay consistent.",
    "Req0's own CLI package.json does not count as a customer app.",
    `Adapter: ${adapter}.`,
  ].join(" ");
}
