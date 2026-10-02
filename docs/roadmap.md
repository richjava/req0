# Roadmap

Milestones 1–4 are the first shippable loop (specify → build → prove). Milestones 5–7 are how a team operates. Do not start 5–7 until 4 is real.

| Milestone | Name | Status |
| --- | --- | --- |
| 1 | The pack exists | **Shipped** (plus design-system restyle) |
| 2 | Jev coaches the spec | **Shipped** (live TypeSafe check; nits do not block Ready) |
| 3 | Coding agent builds from the pack | **Shipped** (launch gated on Ready; Build Succeeded ≠ app boots) |
| 4 | Proof against the same words | **Shipped** (runtime gate; compiled qa-plan; deny is deterministic) |
| 5 | Visual and extra intent | Specified, not built |
| 6 | Living requirements | Specified, not built |
| 7 | Operate as a team | Specified, not built |

## Milestone 1 — The pack exists

Folder convention, frozen grammar, compiler, local cockpit, golden `invoice-approval` pack. Spec meter only. Ready / Build / Proof = Not yet.

**Out:** Jev API, agent launch, browser QA, LLM parsing, Next.js cockpit.

## Milestone 2 — Jev coaches the spec

Frozen catalog only:

- Per rule: noul “Is Statement observable via Observable?”
- Per use case: noul “Does this contradict the matrix for its Actor?”
- Per section: score empty / partial / agent-ready
- One choice: which ID to improve next
- Pack noul: safe to hand to a coding agent?

Blockers (disable Implement): untestable rule, matrix contradiction, role without persona, pack noul below gate. Gate: **zero blockers**. Nits do not block.

Confidence (same idea as Proof): noul ≥ **0.75** pass, ≤ **0.15** fail, else a nit. Pack noul below 0.75 is a blocker.

No API key (`TYPESAFE_API_KEY`) → Ready stays **Not yet**. Persona blockers still apply without a key. Do not fake Jev with regex in production. `REQ0_JEV=mock` is for tests and local demos only.

**Shipped:** parse `fixtures/personas.yaml`, emit `derived/jev-pack.json` from this catalog, Ready meter (blockers first, opinionated Improve pass when blocked or pack noul is below 0.75), live `req0 check` / cockpit **Check this spec with Jev** via TypeSafe System One, mock client in `npm test`.

## Milestone 3 — A coding agent builds from the pack

Portable `implement-brief.md`. Adapters: **Cursor launch**, **Copilot CLI launch**, **Claude Code CLI launch**, **Codex CLI launch**, and **generic manual**. Empty repo = no customer app at repo root (Req0’s own `package.json` does not count). Stack and adapter recorded in `req0.json`. Build Succeeded ≠ app boots.

Implement stays **locked until Ready is Ready**. When Ready, `req0 implement` and the cockpit **Implement** button start the recorded agent (Cursor, Copilot, Claude, or Codex CLI) in the product repo, with `derived/implement-brief.md` in the prompt. `--adapter=manual` only records the run. Empty repo with no recorded stack refuses Implement until `req0.json`, `--stack=`, or the cockpit records one. `"implement": false` in `req0.json` turns the stage off: no build stamp, Implement hidden, Prove uses Ready + runtime. Build Succeeded is not proof the app boots.

**Shipped:** emit `derived/implement-brief.md` on a valid compile, empty-vs-existing product-repo detection, Cursor + Copilot + Claude + Codex CLI launch + manual skip, `derived/build-run.json`, Implement enabled only after Ready.

## Milestone 4 — Proof

Work lives in the **Req0** repo. The app under test is the **product repo** (for the golden loop: invoice-desk). `baseUrl` in `fixtures/runtime.yaml` points at that app. Do not scaffold a second customer app.

### Gate

Prove stays **disabled** until Ready is Ready and `fixtures/runtime.yaml` parses. Build succeeded is also required unless `req0.json` sets `"implement": false` or the owner Ignores a failed Build. Create and Implement write a stub if the file is missing so the gate can open after Ready; the agent must still point `baseUrl` at the real app. Invalid runtime fails closed: Proof stays **Not yet**, next action is still Prove, button off. Hint names the file. Personas stay in `fixtures/personas.yaml`; runtime does not duplicate passwords.

### `fixtures/runtime.yaml`

Required:

```yaml
baseUrl: http://127.0.0.1:3000
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: "button[type=submit]"
```

Optional `startCommand` runs in the product-repo root only if `baseUrl` does not already respond. Optional `resetCommand` runs in the product-repo root before each case so later allows (approve/assign) do not poison deny fixtures. Login is deterministic: the runner fills those selectors with the persona for the case’s Actor. No Jev during login.

### Compiled plan

A valid spec always writes `derived/qa-plan.yaml` from `spec.json` only — one case per use case, never from ad-hoc tests. `kind` is `deny` when a step is `Look for …`. `Choose …` is `allow`, even if the Outcome later says the control is absent or disabled (that is the after-success state). If there is neither verb, an Outcome that the control is not available / absent or disabled / status unchanged is `deny`. `control` is the `Choose` / `Look for` label. The runner executes that file only.

### Runner

- **Deny:** log in, follow Open/Choose/Select steps, then assert `control` is absent or disabled. No Jev. Do not invent HTTP posts; the UI check is the deny proof.
- **Allow:** log in, follow steps, click `control`. Jev noul: does the page observation match the Outcome? Catalog `m4-proof-v1`. Instructions are pack-agnostic (url / text / options / visible controls). Open picks a visible name from the step and preconditions — not product paths.
- Confidence (same gates as Ready): noul ≥ **0.75** pass, ≤ **0.15** fail, else **needs review**. Deterministic deny is pass or fail only.
- Proof meter: `not_yet` / `passed` / `failed` / `needs_review` / `stale` (spec hash changed, or — when Implement is owned — the latest succeeded build `at` differs from `proof-run.buildAt`). Re-prove is allowed.
- Playwright drives Chromium. Jev is the existing TypeSafe client. This is not an npm dependency on `jev-browser`.

**Shipped:** runtime parser, qa-plan emitter, `req0 prove` + cockpit Prove, `derived/proof-run.json`, `derived/proof-report.md`, Proof meter.

## Later

- **M5:** RO types screenshot captions; PNG/JPG/WebP; link one spec ID. No vision model.
- **M6:** AST-id stale + re-prove those cells. Append-only proof history.
- **M7:** Optional `depends_on`, `req0 qa --ci`, GitHub Action example — not a GitHub App. The repo-root pack list (picker, not a portfolio) is in the cockpit.

## Cancelled, not deferred

- Zip ingest
- Org-wide role-migration playbooks
- Hosted multi-tenant workbench (distinct from the local cockpit)

## Alignment

After each milestone: what shipped vs acceptance, any drift, any fence that should change. Improvements are explicit doc edits, not silent scope.

### Milestone 3

Shipped vs acceptance: implement brief, Ready gate, Cursor + Copilot + Claude + Codex + manual adapters, `build-run.json`, `req0.json` stack and adapter. Fence held: Build Succeeded is not proof the app boots.

Drift (fixed here): architecture still listed Jev and coding agents as unbuilt. Roadmap M2 still said invoice-approval is honestly blocked; a live product pack can be Ready with nits. The golden pack in this repo stays Not yet without `TYPESAFE_API_KEY` — that is a key, not a spec failure. Health files are not copied between Req0 and the product repo.

### Milestone 4

Shipped vs acceptance: runtime gate, compiled qa-plan, deterministic deny, Jev noul on allow, Proof meter, cockpit/CLI Prove. Fence held: no screenshot vision (M5), no per-cell stale re-prove (M6), no second customer app, no `jev-browser` package.

Cockpit fence update: the one-next-action rule is now **one primary + staged pill buttons** (Check / Improve it, Implement / Reimplement, Prove / Re-prove). Spec and Ready stay separate. Improve it is one opinionated writer pass for all open Ready findings (including pack-gate) when blocked or pack noul is below 0.75; Jev still only judges.
