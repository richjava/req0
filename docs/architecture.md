# Architecture

Req0 is a TypeScript CLI (`src/`) plus static cockpit files (`cockpit/`). Runtime: Node 22+. No Next.js in this repo — that stack is reserved for apps a coding agent may generate later.

```text
requirement.md  -->  compile (deterministic)  -->  spec.json + health.json + jev-pack.json
                                              -->  implement-brief.md
                                              -->  qa-plan.yaml
personas.yaml   -->  Ready persona blockers
runtime.yaml    -->  Proof gate (baseUrl + login)
                                              -->  cockpit (local HTTP)
```

Later / on **Check with Jev** / **Prove**:

```text
jev-pack.json  -->  TypeSafe POST /v1/systemone  -->  Ready findings
spec.json      -->  implement-brief              -->  coding-agent adapter
qa-plan.yaml   -->  Playwright + Jev noul        -->  Proof meter + proof-report.md
```

## Commands

| Command | Purpose |
| --- | --- |
| `req0 start` | Local cockpit at `http://127.0.0.1:4370` (or next free port) |
| `req0 compile` | Headless compile; exit 2 on grammar errors |
| `req0 create [id]` | Write template, personas stub, and a `runtime.yaml` stub if missing |
| `req0 check` | Run Jev on the frozen catalog. Exit 3 if no API key; exit 2 if Ready is blocked |
| `req0 implement` | Ready gate (exit 2). On Ready, starts a Cursor agent with the implement brief. Activity shows stream-json tools and messages. Build stays running until the agent exits, the owner Stops, 3 sandbox deploys, or 20 minutes. `--adapter=manual` skips launch. `--stack=` records `nextjs-default` or `amplify-gen2` in `req0.json`. Empty repo with no recorded stack refuses (exit 2). Off when `req0.json` has `"implement": false` |
| `req0 prove` | Ready + `fixtures/runtime.yaml` gate (exit 2). Also needs Build succeeded unless implement is off or the owner Ignored a failed Build. Runs compiled `derived/qa-plan.yaml` in a browser |

Pack resolution: current directory if it is `docs/requirements/<id>`, else the only pack under `docs/requirements/`, else the cockpit can create one.

## Compiler

- Implementation: [src/compile.ts](../src/compile.ts)
- Types: [src/types.ts](../src/types.ts)
- Pack I/O: [src/pack.ts](../src/pack.ts)
- HTTP: [src/server.ts](../src/server.ts), CLI: [src/cli.ts](../src/cli.ts)

Compile never calls a model. It writes `derived/jev-pack.json`, `derived/implement-brief.md`, and `derived/qa-plan.yaml` when the spec is valid, and applies persona blockers plus any cached `jev-run.json` and `proof-run.json`. `req0 check` and `POST /api/check-jev` call Jev; TypeSafe failures return a `JevRequestError` (cockpit 502) without dumping secrets. `req0 implement` and `POST /api/implement` launch an adapter only when Ready is Ready and `req0.json` does not set `"implement": false`. `--from-proof` / `{ fromProof: true }` is the same launch after a failed or review proof, using `derived/fix-from-proof-brief.md` and `derived/proof-report.md`. Empty repos also need a recorded stack (`req0.json`, `--stack=`, or `POST /api/stack`). `req0 prove` and `POST /api/prove` run the qa-plan when Ready, runtime.yaml parses, and either Build succeeded, implement is off, or the owner Ignored a failed Build (`POST /api/ignore-build`), then write `derived/proof-run.json` and `derived/proof-report.md`. Tests: `npm test` (Vitest), including the golden pack and mock Jev / mock browser drivers.

Jev client: [src/jev.ts](../src/jev.ts). Live calls are `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer $TYPESAFE_API_KEY`. Catalog emitter: [src/jev-pack.ts](../src/jev-pack.ts). Ready gate: [src/ready.ts](../src/ready.ts), thresholds in [src/gates.ts](../src/gates.ts).

## Cockpit

Vanilla HTML/CSS/JS. Tokens: [cockpit/tokens.css](../cockpit/tokens.css). The server serves `cockpit/` and `/api/state`, `/api/requirement` (PUT markdown), `/api/check-jev`, `/api/implement`, `/api/prove`, create endpoints, and SSE reload.

File watch on `requirement.md` is best-effort. Saves from the cockpit always recompile.

## Layers

- **Jev** — TypeSafe System One. Decision model: `noul`, `choice`, `score` on a `state`. Does not generate text. Authoring catalog frozen in [roadmap.md](roadmap.md). Live coaching needs `TYPESAFE_API_KEY`.
- **Coding agents** — portable `implement-brief.md` plus Cursor and generic manual adapters ([src/implement.ts](../src/implement.ts), [src/stack.ts](../src/stack.ts)). Default Implement starts `cursor agent` with the brief in the prompt. `--adapter=manual` does not start an agent. The brief lists pack files; Implement writes a `runtime.yaml` stub if missing. Recorded stacks: `nextjs-default` and `amplify-gen2`. Domain model must not require Cursor or AWS.
- **Proof** — compiled `qa-plan.yaml`, `fixtures/runtime.yaml`, Playwright driver, deterministic deny UI checks, Jev noul on allow outcomes. In-process observe/act using the existing TypeSafe client. Not a dependency on the `jev-browser` package. Screenshots are Milestone 5.

## Security baseline (when implementing product apps)

No production credentials in packs. Personas are test-only. Permission checks belong on the server, not only hidden buttons. Secrets via environment variables.
