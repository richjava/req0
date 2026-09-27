import type { PersonasResult } from "./personas.js";
import { DEFAULT_STACK, isAmplifyStack, stackInstruction } from "./stack.js";
import type { AdapterId, ProductRepo, SpecAst, StackChoice } from "./types.js";

export function emitImplementBrief(input: {
  spec: SpecAst;
  repo: ProductRepo;
  adapter: AdapterId;
  personas?: PersonasResult;
}): string {
  const { spec, repo, adapter, personas } = input;
  const lines: string[] = [
    `# Implement: ${spec.title}`,
    "",
    "Portable coding-agent brief. Read this file, then the compiled `derived/spec.json`. Do not invent rule, use-case, or role IDs.",
    "",
    "## Stack",
    "",
    stackInstruction(repo, adapter),
    "",
    `Default stack (empty repo only): ${DEFAULT_STACK.label}.`,
    "",
  ];

  if (isAmplifyStack(repo.stack)) {
    lines.push(
      "## AWS",
      "",
      "Scaffold Next.js plus `amplify/` (Cognito Auth, Data, S3 Storage). Named BR- and UC- IDs only.",
      "Map matrix roles to Cognito groups. Seed test users from existing `fixtures/personas.yaml`.",
      "First-party `/login` with `#email` and `#password`. Do not use Cognito Hosted UI.",
      "",
      "1. Identity. `ampx` does not read `.env`. It uses `AWS_PROFILE`, inherited `AWS_ACCESS_KEY_ID`, or `~/.aws`. If this process has none of those, stop. Tell the owner: create a non-root IAM user, attach the Amplify backend deploy policy, run `npx ampx configure profile`, then re-run Implement. Do not ask for keys in chat. Do not print env values. Do not invent pool ids. IAM user keys do not use `AWS_SESSION_TOKEN`; that name is for temporary or SSO creds, and for Lambda `DataClientEnv` at runtime.",
      "2. Toolchain. Prefer Node 20 or 22. Pin `tsx@4.19.4`. On Node 24, use explicit `.ts` imports under `amplify/` and `allowImportingTsExtensions` in `amplify/tsconfig.json`. After changing Node, tsx, or packages, restart sandbox — do not keep an old watch.",
      "3. Scaffold. Ship ambient `$amplify/env/<function>` declarations matching `DataClientEnv` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`, `AMPLIFY_DATA_DEFAULT_NAME`). No top-level import in that `.d.ts`. Exclude `amplify/` from the Next.js tsconfig. Resolve seed script paths with `fileURLToPath(import.meta.url)`, not `import.meta.dirname`.",
      "4. Deploy. After scaffolding `amplify/`, run `npx ampx sandbox --once` in the product repo (`--profile <name>` when identity is a profile). Wait until it finishes. `amplify_outputs.json` must have a real `user_pool_id` (`us-east-1_…` or `ap-southeast-2_…`). Never leave `REPLACE_VIA_SANDBOX` — the browser then calls `cognito-idp.replace.amazonaws.com` (`ERR_NAME_NOT_RESOLVED`). That is not a missing persona. A missing seeded user is a real Cognito error against `cognito-idp.<region>.amazonaws.com`. `npm install` is not a deploy. If sandbox says the region is not bootstrapped, stop and tell the owner to create the `CDKToolkit` stack once as root or AdministratorAccess.",
      "5. App then seed. Restart `npm run dev` after outputs change. Seed Cognito users from `fixtures/personas.yaml` only after those real outputs exist. Point `fixtures/runtime.yaml` `baseUrl` at the running app. `resetCommand` must reseed Cognito users and fixture data.",
      "6. Gitignore `.env`, `.amplify`, and `amplify_outputs*`. Keep `.env.example` (names only).",
      "",
    );
  }

  lines.push(
    "## Overview",
    "",
    spec.optional.Overview?.trim() || "See the business rules and use cases.",
    "",
  );

  if (spec.optional["Out of scope"]?.trim()) {
    lines.push("## Out of scope", "", spec.optional["Out of scope"].trim(), "");
  }

  lines.push(
    "## Acceptance criteria (business rules)",
    "",
    "Each rule is an acceptance criterion. Implement the Observable, not a paraphrase.",
    "",
  );
  for (const rule of spec.businessRules) {
    lines.push(`### ${rule.id} — ${rule.title}`, "", `- Statement: ${rule.statement}`, `- Observable: ${rule.observable}`, "");
  }

  lines.push("## Flows (use cases)", "");
  for (const useCase of spec.useCases) {
    lines.push(`### ${useCase.id} — ${useCase.title}`, "", `- Actor: ${useCase.actor}`, `- Preconditions: ${useCase.preconditions}`, "- Steps:");
    useCase.steps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step}`);
    });
    lines.push(`- Outcome: ${useCase.outcome}`);
    if (useCase.alternatePaths) lines.push(`- Alternate paths: ${useCase.alternatePaths}`);
    lines.push("");
  }

  lines.push("## Authorization (roles and permissions)", "", `| Action | ${spec.matrix.roles.join(" | ")} |`, `| --- | ${spec.matrix.roles.map(() => "---").join(" | ")} |`);
  for (const action of spec.matrix.actions) {
    const cells = spec.matrix.roles.map((role) => action.permissions[role] ?? "");
    lines.push(`| ${action.id} | ${cells.join(" | ")} |`);
  }
  lines.push("", "Permission checks belong on the server, not only hidden buttons.", "");

  lines.push("## Personas (test only)", "", "Never production credentials. Seed these users so role QA can log in later.", "");
  if (personas && personas.personas.size > 0) {
    for (const persona of personas.personas.values()) {
      lines.push(`- ${persona.role}: ${persona.email}`);
    }
    lines.push("", "Passwords and extras: `fixtures/personas.yaml`.", "");
  } else {
    lines.push("No personas parsed. See `fixtures/personas.yaml`. Ready will block Implement until each matrix role has one.", "");
  }

  if (spec.optional.Entities?.trim()) {
    lines.push("## Entities", "", spec.optional.Entities.trim(), "");
  }
  if (spec.optional["UI notes"]?.trim()) {
    lines.push("## UI notes", "", spec.optional["UI notes"].trim(), "");
  }
  if (spec.optional["Open questions"]?.trim()) {
    lines.push("## Open questions", "", spec.optional["Open questions"].trim(), "");
  }

  lines.push(
    "## Product README",
    "",
    "Write `README.md` at the product repo root so a stranger can run the app. If a README already exists, update the setup section. Use this requirement's title and the pack paths below. Do not invent a product name.",
    "",
    "~~~~markdown",
    productReadmeTemplate(spec, repo.stack),
    "~~~~",
    "",
  );

  lines.push(
    "## Pack files",
    "",
    "- Seed the app from existing `fixtures/personas.yaml`. Do not add roles. Do not invent emails.",
    "- `fixtures/runtime.yaml` may be a stub. Set `baseUrl`, `startCommand`, and `resetCommand` to the app you started. Keep login selectors unless you change `/login` to match — then change both.",
    "- Write or update the product-repo `.env.example` with variable names only. No real keys.",
    "- Write `README.md` at the product repo root using the Product README section. Use this requirement's title and pack paths. Do not invent a product name.",
    "- The seed/reset script command must match `runtime.yaml` `resetCommand`.",
    "- First-party `/login` must match those selectors.",
    "",
    "## Security baseline",
    "",
    "- No production credentials in the spec or this brief.",
    "- Secrets via environment variables.",
    "- Personas are test-only.",
    "",
    "## Done means",
    "",
    isAmplifyStack(repo.stack)
      ? "The app exists in the recorded stack. AWS identity was available (profile or inherited keys). `npx ampx sandbox --once` has been run. `amplify_outputs.json` has real Cognito ids, not `REPLACE_VIA_SANDBOX`. Personas are seeded in Cognito. `fixtures/runtime.yaml` matches that app. Product `.env.example` has names only. Product `README.md` has setup for this stack."
      : "The app exists in the recorded stack. Personas are seeded. `fixtures/runtime.yaml` matches that app. Product `.env.example` has names only. Product `README.md` has setup for this stack.",
    "A coding-agent run finishing is **Build Succeeded**, not “the app boots.” Boot and login are Proof (Milestone 4).",
    "",
  );

  return `${lines.join("\n")}\n`;
}

export function productReadmeTemplate(spec: SpecAst, stack: StackChoice): string {
  const overview =
    spec.optional.Overview?.trim().split(/\n\n/)[0]?.replace(/\s+/g, " ").trim() ||
    "See the business rules and use cases.";
  const pack = `docs/requirements/${spec.requirementId}`;
  const stackLine = isAmplifyStack(stack)
    ? "Amplify Gen 2 (Cognito Auth, Data, S3) + Next.js App Router."
    : `${stack.label}.`;

  if (isAmplifyStack(stack)) {
    return [
      `# ${spec.title}`,
      "",
      overview,
      "",
      "## Stack",
      "",
      stackLine,
      "",
      "## Setup",
      "",
      "1. Copy `.env.example` to `.env` and set `AWS_REGION` plus `AWS_PROFILE` or access keys. `ampx` does not read `.env` — export the vars or run `npx ampx configure profile`.",
      "2. Deploy the sandbox backend (writes `amplify_outputs.json`):",
      "",
      "```bash",
      "npm run sandbox",
      "```",
      "",
      "3. In another terminal, seed Cognito personas and fixture data:",
      "",
      "```bash",
      "npm run db:seed",
      "```",
      "",
      "4. Start the app (restart after `amplify_outputs.json` changes):",
      "",
      "```bash",
      "npm run dev",
      "```",
      "",
      `Login personas are in \`${pack}/fixtures/personas.yaml\`.`,
      "",
      `Req0 runtime: \`${pack}/fixtures/runtime.yaml\`.`,
      "",
    ].join("\n");
  }

  return [
    `# ${spec.title}`,
    "",
    overview,
    "",
    "## Stack",
    "",
    stackLine,
    "",
    "## Setup",
    "",
    "1. Copy `.env.example` to `.env` and fill the names in that file.",
    "2. Seed fixture data:",
    "",
    "```bash",
    "npm run db:seed",
    "```",
    "",
    "3. Start the app:",
    "",
    "```bash",
    "npm run dev",
    "```",
    "",
    `Login personas are in \`${pack}/fixtures/personas.yaml\`.`,
    "",
    `Req0 runtime: \`${pack}/fixtures/runtime.yaml\`.`,
    "",
  ].join("\n");
}
