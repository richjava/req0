# Cockpit

The Requirement Owner’s home. Launch with `npm start` or `req0 start` from the repo or a pack folder.

**One home, one scoreboard, one primary next action plus staged pill buttons.** Not a second IDE, not a cloud app. Spec and Ready stay separate meters: valid grammar is not Ready.

## Layout (design system)

ClickUp-inspired product chrome — see [design-system.md](design-system.md).

- Light sidebar (`--surface-1`): pack name, sections, findings
- Recessed canvas (`--surface-0`): how-this-is-going, primary next action, status pills with staged buttons (Build is omitted when `req0.json` sets `"implement": false`), raised editor panel (`--surface-2`)

## Health meters

A meter that is not born yet reads **Not yet**, never Fail.

| Meter | Meaning when set | Born in |
| --- | --- | --- |
| Spec | Empty / Drafting / Valid (grammar only) | Milestone 1 |
| Ready | Not yet / Blocked / Ready. After a current Jev run the pill shows pack noul (`Ready · 0.91`). Persona blockers do not need Jev. Jev scores need an API key. Saving `requirement.md` invalidates `jev-run` until Check. | Milestone 2 |
| Build | Coding-agent run finished (not “app works”) | Milestone 3 |
| Proof | Browser QA vs the pack | Milestone 4 |

Never collapse these meanings.

Health is also a file: `derived/health.json` and `derived/status.md`. Git, CI (later), and the cockpit must agree.

## Pipeline

Specify → Check → Build → Prove. Each pill owns its badge and a button. The topbar repeats the **primary** stage (leftmost forward action).

| Pill | Badge | Button | Enabled when |
| --- | --- | --- | --- |
| Spec | Empty / Drafting / Valid | none | compile is on save |
| Ready | Not yet / Blocked / Ready + noul | **Check** if no current Jev; **Improve it** if Ready is blocked, pack noul is below 0.75, or a persona is missing; hidden after Ready | Spec Valid; Check needs an API key (fail-closed) |
| Build | Not yet / Implementing / Succeeded / Failed / Stale. The whole pill is hidden when `req0.json` has `"implement": false` | **Implement** if never succeeded; **Rebuild** if succeeded or stale; **Ignore** if failed; **Stop** while Implementing | Ready is Ready, and a stack is recorded when the product repo is empty. Stays **Implementing** until the Cursor agent exits, the owner **Stop**s, 3 `ampx sandbox --once` deploys, or 20 minutes. **Ignore** asks whether implementation succeeded: Yes marks Build successful, No leaves it failed, and both unlock Prove |
| Proof | Not yet until a run for this spec (and this build, when Implement is owned); else Passed / Failed / Needs review / Stale | **Prove** first time; **Re-prove** if a run exists or is stale | Ready, `runtime.yaml` parses, and either Build succeeded, implement is off, or the owner Ignored a failed Build |

Proof is stale if the spec hash changed, or — when Implement is owned — the latest succeeded build `at` differs from `proof-run.buildAt`. Same spec + new Rebuild ⇒ Re-prove. When implement is off, stale is spec-only. Each Prove also writes `derived/proof-report.md` — a human-readable case report for QA. `status.md` stays the scoreboard.

## Improve it vs Check vs Proof findings

- **Check** asks Jev to judge the spec. Jev does not write `requirement.md`.
- **Improve it** is a writer: one click writes `derived/improve-brief.md` with the writer rules already in it, then launches Cursor. The brief covers every open Ready finding in one opinionated pass, including pack-gate and section nits. A finding that was just **Accepted** is skipped until the next Check (`derived/improve-log.json`). After Ready (pack noul at or above 0.75), Improve is hidden — leftover nits are not a second loop. Persona-missing may add `role@example.test` / `test-only-not-production`. Fences: no new BR-/UC- IDs, no flipping Choose/Look-for allow/deny, no matrix talk (`is allow` / `is deny`) in Outcomes. After the patch, the canvas shows a unified diff. **Accept** is refused if the diff adds matrix talk. **Reject** restores the snapshot. Then Check. Do not auto-Check. Product-app diffs stay out.
- **Proof findings** stay out of Improve it.

## Reload contract

The cockpit **polls** `GET /api/state`. It must never open EventSource or any other request that does not finish. A browser refresh waits for in-flight requests; an unfinished stream hangs the tab forever. `GET /api/events` is retired and returns **410** immediately so leftover clients cannot pin a reload. Tests in `src/server.test.ts` enforce this.

## Interaction contract

1. Open the cockpit.
2. See health, the primary next action, and the staged pill buttons.
3. Confirm that action, or edit the spec.
4. Compiler (or later Jev / agent / browser) updates health.
5. The next action changes. The RO does not memorize CLI flags.

After Spec Valid, the Ready button is **Check**. Without `TYPESAFE_API_KEY` the click fails closed: Ready stays **Not yet**, and TypeSafe errors surface as a 502 with the server message (no secrets). A matrix role without a persona is a Ready blocker immediately; **Improve it** can add that persona without Jev. After a passing Jev run, primary becomes **Implement** — unless `req0.json` sets `"implement": false`, in which case primary is **Prove**. On an empty product repo with no stack, Implement stays disabled until the owner picks **Next.js default** or **Amplify Gen 2** (same as writing `req0.json` or `req0 implement --stack=`). While the Cursor agent runs, Build stays **Implementing**, primary is **Stop**, and Activity shows tools and messages from the agent stream. The run also stops after 3 `ampx sandbox --once` deploys or 20 minutes. After the agent exits, Activity records that it finished. After Build succeeded, when implement is off, or after **Ignore** on a failed Build, primary is **Prove**. It stays disabled until `fixtures/runtime.yaml` parses; then it runs compiled `derived/qa-plan.yaml` in a browser. After Proof **failed** or **needs review**, primary is **Fix from proof** (Build pill stays **Rebuild**). That agent reads `derived/proof-report.md` plus the implement brief and must not edit `requirement.md`. **Improve it** stays Ready-only.

## Editing

The RO may edit in the cockpit or in the IDE. The cockpit markdown editor defaults to **Preview** (rendered display), with **Edit** (source) and **Split**. A toolbar inserts markdown markers (bold, italic, heading H1–H6, lists, link) into the source — it does not rewrite the frozen grammar. Saving PUTs markdown and recompiles. A current Jev score becomes stale until Check. Section nav and findings switch to Edit and jump to the matching heading, line, or spec ID. **Improve it** writes one opinionated brief for all open findings, then shows Accept/Reject.

## Create

Empty pack folder: next action **Create this requirement** writes the template. From repo root with no pack: create bar asks for a kebab-case id.
