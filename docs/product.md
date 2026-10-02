# Product overview

Req0 is a **requirement operating system** that lives in a product git repo. A person (the Requirement Owner) writes a structured requirement pack. Design, implementation, and QA are supposed to use that same pack — not a parallel ticket, Confluence page, or test script.

## What it does today

1. You keep packs under `docs/requirements/<kebab-id>/`.
2. `requirement.md` follows a [frozen grammar](grammar.md).
3. A deterministic compiler writes `derived/spec.json`, `derived/health.json`, `derived/status.md`, and (when valid) `derived/jev-pack.json` and `derived/implement-brief.md`.
4. `req0 start` opens a local [cockpit](cockpit.md) so the owner can see health and the next action.

Jev (TypeSafe System One) judges a frozen catalog when you set `TYPESAFE_API_KEY` and run **Check this spec with Jev**. Implement launches only after Ready is Ready, unless `req0.json` sets `"implement": false`. **Prove this requirement** runs compiled `qa-plan.yaml` against `fixtures/runtime.yaml` after Ready — and after Build succeeded, unless implement is off or the owner Ignored a failed Build.

## What it does not do

- Jev does not write code, tests, or prose. It will only **judge** (Milestone 2+).
- Req0 does not generate the customer’s application in Milestone 1.
- Zip ingest is out. Git folders are the distribution mechanism.
- This is not a hosted SaaS or a ClickUp clone. The cockpit is local, inspired by ClickUp’s product workspace.

## Single source of truth

| Artifact | Role |
| --- | --- |
| `requirement.md` | Humans write this |
| `derived/spec.json` | Compiler AST; later stages consume this, not raw prose |
| `derived/health.json` | Scoreboard the cockpit and git share |
| `fixtures/personas.yaml` | Test users per role (stub allowed until Ready/QA) |
| `fixtures/runtime.yaml` | Where the app is and how to log in (Create/Implement write a stub if missing) |
| `derived/proof-report.md` | Last Prove, written for a QA reader (same UC- IDs as the pack) |
| `req0.json` | Product-repo policy: stack, adapter, and whether Req0 owns Implement (`"implement": false` skips that stage) |
| `.env.example` | Names only. Written if missing when `amplify-gen2` is recorded. Copy to `.env`; do not put real keys in the example |

If the markdown cannot be compiled, nothing downstream should guess. Invalid specs fail with a line number.

## Default generated app (when we implement)

Only used later, when a coding agent sees an **empty** product repo (no customer app at repo root; Req0’s own package.json does not count): Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth (default), or Amplify Gen 2 (`amplify-gen2` in `req0.json`). The cockpit records **I’ll write the code**, **Cursor**, **Copilot**, **Claude**, or **Codex**, then a stack when an agent will implement. Same as writing `req0.json` or passing `--adapter=` / `--stack=`. Implement on an empty repo refuses until a stack is recorded. Set `"implement": false` when this repo is built another way.

Before Implement on `amplify-gen2`, the owner needs an AWS identity the process can see: `npx ampx configure profile`, or exported `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Recording that stack writes a names-only `.env.example` if it is missing. `ampx` does not read `.env`. Do not put keys in Req0’s `.env`. The implement brief requires identity first, then `npx ampx sandbox --once` (with `--profile` when using a profile) so `amplify_outputs.json` gets real Cognito ids, not `REPLACE_VIA_SANDBOX`. If there is no profile and no inherited keys, the agent must stop — not invent pool ids. Create/Implement write a `fixtures/runtime.yaml` stub if it is missing; the agent must point `baseUrl` and reset at the app.

Req0 **itself** stays a TypeScript CLI plus a thin local HTML cockpit. Do not build the cockpit in Next.js.
