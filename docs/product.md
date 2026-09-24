# Product overview

Req0 is a **requirement operating system** that lives in a product git repo. A person (the Requirement Owner) writes a structured requirement pack. Design, implementation, and QA are supposed to use that same pack — not a parallel ticket, Confluence page, or test script.

## What it does today

1. You keep packs under `docs/requirements/<kebab-id>/`.
2. `requirement.md` follows a [frozen grammar](grammar.md).
3. A deterministic compiler writes `derived/spec.json`, `derived/health.json`, `derived/status.md`, and (when valid) `derived/jev-pack.json` and `derived/implement-brief.md`.
4. `req0 start` opens a local [cockpit](cockpit.md) so the owner can see health and the next action.

Jev (TypeSafe System One) judges a frozen catalog when you set `TYPESAFE_API_KEY` and run **Check this spec with Jev**. Implement launches only after Ready is Ready, unless `req0.json` sets `"implement": false`. **Prove this requirement** runs compiled `qa-plan.yaml` against `fixtures/runtime.yaml` after Ready — and after Build succeeded, unless implement is off.

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
| `fixtures/runtime.yaml` | Where the app is and how to log in (required to enable Prove) |
| `derived/proof-report.md` | Last Prove, written for a QA reader (same UC- IDs as the pack) |
| `req0.json` | Product-repo policy: stack, adapter, and whether Req0 owns Implement (`"implement": false` skips that stage) |

If the markdown cannot be compiled, nothing downstream should guess. Invalid specs fail with a line number.

## Default generated app (when we implement)

Only used later, when a coding agent sees an **empty** product repo (no customer app at repo root; Req0’s own package.json does not count): Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth. The choice will be recorded in `req0.json`. Set `"implement": false` in that file when this repo is built another way; Req0 still compiles `implement-brief.md` but does not own the Implement stage.

Req0 **itself** stays a TypeScript CLI plus a thin local HTML cockpit. Do not build the cockpit in Next.js.
