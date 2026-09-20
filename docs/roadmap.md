# Roadmap

Milestones 1–4 are the first shippable loop (specify → build → prove). Milestones 5–7 are how a team operates. Do not start 5–7 until 4 is real.

| Milestone | Name | Status |
| --- | --- | --- |
| 1 | The pack exists | **Shipped** (plus design-system restyle) |
| 2 | Jev coaches the spec | **Shipped** (live TypeSafe check; invoice-approval is honestly blocked) |
| 3 | Coding agent builds from the pack | **Shipped** (launch gated on Ready; Prove stays disabled) |
| 4 | Proof against the same words | Specified, not built |
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

**Shipped:** parse `fixtures/personas.yaml`, emit `derived/jev-pack.json` from this catalog, Ready meter (blockers first, Improve next-id), live `req0 check` / cockpit **Check this spec with Jev** via TypeSafe System One, mock client in `npm test`.

## Milestone 3 — A coding agent builds from the pack

Portable `implement-brief.md`. Adapters: **Cursor launch** and **generic manual** only. Empty repo = no customer app at repo root (Req0’s own `package.json` does not count). Stack recorded in `req0.json` when Implement actually runs. Build Succeeded ≠ app boots.

Implement stays **locked until Ready is Ready**. When Ready, `req0 implement` and the cockpit next action launch the Cursor adapter (or `--adapter=manual`). Empty repo records the default stack in `req0.json`. Build Succeeded is not proof the app boots; Prove stays disabled until Milestone 4.

**Shipped:** emit `derived/implement-brief.md` on a valid compile, empty-vs-existing product-repo detection, Cursor + manual adapters, `derived/build-run.json`, Implement enabled only after Ready.

## Milestone 4 — Proof

Blocked without `fixtures/runtime.yaml` (`baseUrl`, optional `startCommand`, deterministic login). Runner executes compiled `qa-plan.yaml` only. Deny prefers deterministic UI checks. Confidence: noul ≥ 0.75 pass, ≤ 0.15 fail, else needs review.

## Later

- **M5:** RO types screenshot captions; PNG/JPG/WebP; link one spec ID. No vision model.
- **M6:** AST-id stale + re-prove those cells. Append-only proof history.
- **M7:** Repo-root pack list, optional `depends_on`, `req0 qa --ci`, GitHub Action example — not a GitHub App.

## Cancelled, not deferred

- Zip ingest
- Org-wide role-migration playbooks
- Hosted multi-tenant workbench (distinct from the local cockpit)

## Alignment

After each milestone: what shipped vs acceptance, any drift, any fence that should change. Improvements are explicit doc edits, not silent scope.
