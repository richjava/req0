# Architecture

Req0 is a TypeScript CLI (`src/`) plus static cockpit files (`cockpit/`). Runtime: Node 22+. No Next.js in this repo — that stack is reserved for apps a coding agent may generate later.

```text
requirement.md  -->  compile (deterministic)  -->  spec.json + health.json + jev-pack.json
                                              -->  implement-brief.md
personas.yaml   -->  Ready persona blockers
                                              -->  cockpit (local HTTP)
```

Later / on **Check with Jev**:

```text
jev-pack.json  -->  TypeSafe POST /v1/systemone  -->  Ready findings
spec.json      -->  implement-brief              -->  coding-agent adapter
               -->  qa-plan.yaml                 -->  browser runner + Jev
```

## Commands

| Command | Purpose |
| --- | --- |
| `req0 start` | Local cockpit at `http://127.0.0.1:4370` (or next free port) |
| `req0 compile` | Headless compile; exit 2 on grammar errors |
| `req0 create [id]` | Write template + personas stub |
| `req0 check` | Run Jev on the frozen catalog. Exit 3 if no API key; exit 2 if Ready is blocked |
| `req0 implement` | Ready gate (exit 2). On Ready, launches Cursor (or `--adapter=manual`) and records `req0.json` |

Pack resolution: current directory if it is `docs/requirements/<id>`, else the only pack under `docs/requirements/`, else the cockpit can create one.

## Compiler

- Implementation: [src/compile.ts](../src/compile.ts)
- Types: [src/types.ts](../src/types.ts)
- Pack I/O: [src/pack.ts](../src/pack.ts)
- HTTP: [src/server.ts](../src/server.ts), CLI: [src/cli.ts](../src/cli.ts)

Compile never calls a model. It writes `derived/jev-pack.json` and `derived/implement-brief.md` when the spec is valid, and applies persona blockers plus any cached `jev-run.json`. `req0 check` and `POST /api/check-jev` call Jev; TypeSafe failures return a `JevRequestError` (cockpit 502) without dumping secrets. `req0 implement` and `POST /api/implement` launch an adapter only when Ready is Ready. Tests: `npm test` (Vitest), including the golden pack and a mock Jev client.

Jev client: [src/jev.ts](../src/jev.ts). Live calls are `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer $TYPESAFE_API_KEY`. Catalog emitter: [src/jev-pack.ts](../src/jev-pack.ts). Ready gate: [src/ready.ts](../src/ready.ts), thresholds in [src/gates.ts](../src/gates.ts).

## Cockpit

Vanilla HTML/CSS/JS. Tokens: [cockpit/tokens.css](../cockpit/tokens.css). The server serves `cockpit/` and `/api/state`, `/api/requirement` (PUT markdown), `/api/check-jev`, `/api/implement`, create endpoints, and SSE reload.

File watch on `requirement.md` is best-effort. Saves from the cockpit always recompile.

## Layers not built yet

- **Jev** — TypeSafe System One. Decision model: `noul`, `choice`, `score` on a `state`. Does not generate text. Catalog frozen in [roadmap.md](roadmap.md). Live coaching needs `TYPESAFE_API_KEY`.
- **Coding agents** — portable `implement-brief.md` plus Cursor and generic manual adapters ([src/implement.ts](../src/implement.ts), [src/stack.ts](../src/stack.ts)). Launch is gated on Ready. Domain model must not require Cursor.
- **Proof** — jev-browser + deterministic login fixture in Milestone 4.

## Security baseline (when implementing product apps)

No production credentials in packs. Personas are test-only. Permission checks belong on the server, not only hidden buttons. Secrets via environment variables.
