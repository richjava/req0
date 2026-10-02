# Cockpit

The Requirement Owner’s home. Launch with `npm start` or `req0 start` from the repo or a pack folder.

**One home, one scoreboard, one primary next action plus staged buttons on the selected stage.** Not a second IDE, not a cloud app. Spec and Ready stay separate checks: valid grammar is not ready to implement.

From the **product repo**, the cockpit opens on a **requirement list**: each row is an id, title, and the four meters. Click a row to enter that pack’s cockpit. Create a pack from the list. The logo and **All requirements** return to the list. Starting inside a pack folder opens that pack directly. This is a picker, not a portfolio: no merged pipelines.

## Layout (design system)

ClickUp-inspired product chrome — see [design-system.md](design-system.md).

- **Topbar** — pack name, how-this-is-going, primary next action (icon + label). The action hint is on hover, not beside the button. Favicons and `site.webmanifest` live with the other cockpit static files. The wordmark and **All requirements** go back to the list. The header CTA is hidden on the list.
- **Requirement list** — home when no pack is selected. Rows show Spec, Judgment, Implement (when owned), and QA meters. Create-pack lives here. Right-click a row for **Delete**; confirm, then the pack folder is removed.
- **Pipeline graph** — Start → Define → Implement → QA → End as labeled circles on a thin rail. Spec and Judgment hang under Define. Implement is omitted when `req0.json` sets `"implement": false`. Dots use existing status tokens (idle / draft / ok / bad / progress), not Jenkins green.
- **Stage workspace** — nested nav on the left (Define ▾ Spec, Judgment; Implement; QA) and content on the right. Define’s children start expanded. The chevron collapses Spec and Judgment; the Define row still opens the editor.

| Nav | Content |
| --- | --- |
| **Define** | `requirement.md` editor (Preview / Edit / Split). After **Create pack**, an in-stage description panel starts AI authoring. Authoring questions, Skip / Skip all, optional screenshot upload, and authoring Activity stay here. Improve patch review stays here. Agent questions for Improve also stay here: Continue / Stop in the workspace head, then the questionnaire. |
| **Spec** | Status bar (Valid / Drafting / Empty), required/optional `##` sections, purpose, present/missing/error, compile findings |
| **Judgment** | Status bar (Clear + noul / Blocked / Not yet), Check / Improve it, Ready findings. Clicking a finding opens Define and jumps in the editor. |
| **Implement** | Status bar, stage CTAs, then Activity. When the agent has questions, Questions / Activity tabs (Questions first and default). If there is no activity yet, the questionnaire is the main pane. Stop / Ignore / Reimplement. Stop uses the same secondary pill as Ignore, not status-bad red. No editor. |
| **QA** | Status bar, stage CTAs, then Activity. When a proof report exists, Activity / Report tabs (Activity first and default). Prove / Re-prove / Fix from proof. No editor. |

Create-pack stays a Start gate. If the product repo has no coding choice yet, the cockpit asks whether the owner will write the code (Implement off) or use **Cursor** or **Copilot**. Empty repos still need **Next.js default** or **Amplify Gen 2** when an agent will implement. That records `req0.json` (same as `--adapter=` and `--stack=`).

Display names are **Define / Implement / QA** and Judgment status **Clear**. File keys in `health.json` stay `spec` / `ready` / `build` / `proof`.

## Health meters

A meter that is not born yet reads **Not yet**, never Fail. Graph badges use the same states with display labels.

| File key | Graph / nav | Meaning when set | Born in |
| --- | --- | --- | --- |
| `spec` | Spec (under Define) | Empty / Drafting / Valid (grammar only) | Milestone 1 |
| `ready` | Judgment (under Define) | Not yet / Blocked / **Clear**. After a current Jev run the badge shows pack noul (`Clear · 0.91`). Persona blockers do not need Jev. Jev scores need an API key. Saving `requirement.md` invalidates `jev-run` until Check. | Milestone 2 |
| `build` | Implement | Coding-agent run finished (not “app works”). Hidden when `implement` is false. | Milestone 3 |
| `proof` | QA | Browser QA vs the pack | Milestone 4 |

Never collapse these meanings. Never merge Spec and Ready into one meter.

Health is also a file: `derived/health.json` and `derived/status.md`. Git, CI (later), and the cockpit must agree.

## Pipeline

Start → Define → Implement → QA → End. Click a graph node to select that stage. The topbar repeats the **primary** action (leftmost forward action). Staged buttons live on the selected pane.

| Stage | Badge | Button | Enabled when |
| --- | --- | --- | --- |
| Spec | Empty / Drafting / Valid | none | compile is on save |
| Judgment | Not yet / Blocked / Clear + noul | **Check** if no current Jev; **Improve it** if Ready is blocked, pack noul is below 0.75, or a persona is missing; hidden after Ready | Spec Valid; Check needs an API key (fail-closed) |
| Implement | Not yet / Implementing / Succeeded / Failed / Stale. The node is omitted when `req0.json` has `"implement": false` | **Implement** if never succeeded; **Reimplement** if succeeded or stale; **Ignore** if failed; **Stop** while Implementing | Ready is Ready (`ready.state === "ready"`), and a stack is recorded when the product repo is empty. Stays **Implementing** until the Cursor stream reports `result`, the process exits, the owner **Stop**s, 3 `ampx sandbox --once` deploys, or 20 minutes. A hung CLI after `result` is killed; that is still Build succeeded. **Ignore** asks whether implementation succeeded: Yes marks Build successful, No leaves it failed, and both unlock Prove |
| QA | Not yet until a run for this spec (and this build, when Implement is owned); else Passed / Failed / Needs review / Stale | **Prove** first time; **Re-prove** if a run exists or is stale | Ready, `runtime.yaml` parses, and either Build succeeded, implement is off, or the owner Ignored a failed Build |

Start lights when a pack exists (Create lives here if empty). End lights when QA passed.

Proof is stale if the spec hash changed, or — when Implement is owned — the latest succeeded build `at` differs from `proof-run.buildAt`. Same spec + new Reimplement ⇒ Re-prove. When implement is off, stale is spec-only. Each Prove also writes `derived/proof-report.md` — a human-readable case report for QA. `status.md` stays the scoreboard.

## Improve it vs Check vs Proof findings

- **Check** asks Jev to judge the spec. Jev does not write `requirement.md`.
- **Improve it** is a writer: one click writes `derived/improve-brief.md` with the writer rules already in it, then launches Cursor. The brief covers every open Ready finding in one opinionated pass, including pack-gate and section nits. A finding that was just **Accepted** is skipped until the next Check (`derived/improve-log.json`). After Ready (pack noul at or above 0.75), Improve is hidden — leftover nits are not a second loop. Persona-missing may add `role@example.test` / `test-only-not-production`. If a required decision is missing, the agent writes `derived/agent-questions.json` and stops; the owner answers on Define, then **Continue**. Fences: no new BR-/UC- IDs, no flipping Choose/Look-for allow/deny, no matrix talk (`is allow` / `is deny`) in Outcomes. After the patch, the canvas shows a unified diff. **Accept** is refused if the diff adds matrix talk. **Reject** restores the snapshot. Then Check. Do not auto-Check. Product-app diffs stay out.
- **Proof findings** stay out of Improve it.

## Reload contract

The cockpit **polls** `GET /api/state`. It must never open EventSource or any other request that does not finish. A browser refresh waits for in-flight requests; an unfinished stream hangs the tab forever. `GET /api/events` is retired and returns **410** immediately so leftover clients cannot pin a reload. Tests in `src/server.test.ts` enforce this.

## Interaction contract

1. Open the cockpit. If the product repo is empty and no stack is recorded, choose a stack first. From the product repo, pick a requirement from the list (or create one). From a pack folder, the graph + Define editor open for that pack.
2. Primary next action stays in the topbar.
3. Drill Spec / Judgment for structure vs Jev; Implement for the agent log; QA for Prove activity, and the report when one exists.
4. Confirm that action, or edit the spec on Define.
5. Compiler (or later Jev / agent / browser) updates health. The next action changes. The RO does not memorize CLI flags.

After Spec Valid, Judgment’s button is **Check**. Without `TYPESAFE_API_KEY` the click fails closed: Ready stays **Not yet**, and TypeSafe errors surface as a 502 with the server message (no secrets). A matrix role without a persona is a Ready blocker immediately; **Improve it** can add that persona without Jev. After a passing Jev run, primary becomes **Implement** — unless `req0.json` sets `"implement": false`, in which case primary is **Prove**. On an empty product repo with no stack, the cockpit does not open the graph until the owner picks **Next.js default** or **Amplify Gen 2** (same as writing `req0.json` or `req0 implement --stack=`). While the Cursor agent runs, Implement stays **Implementing**, primary is **Stop**, and Activity on Implement shows tools and messages from the agent stream. When the stream reports that the agent finished, Activity records that and Build succeeds even if the CLI process has not exited yet. If the agent writes `derived/agent-questions.json` and stops, primary becomes **Continue**, Implement (or Define, for Improve and authoring) opens automatically, and Build stays **Implementing** until the owner Continues or Stops. Answered Implement questions stay in that file and are included on later Implement and Fix from proof launches. Improve answers are only used for that resume; the next Improve it reads `requirement.md`. Authoring answers are used for that resume only; `requirement.md` is the memory after a writer pass. Prove writes a separate log on QA. The run also stops after 3 `ampx sandbox --once` deploys or 20 minutes. After the agent exits, Activity records that it finished. After Build succeeded, when implement is off, or after **Ignore** on a failed Build, primary is **Prove**. It stays disabled until `fixtures/runtime.yaml` parses; then it runs compiled `derived/qa-plan.yaml` in a browser. After Proof **failed** or **needs review**, primary is **Fix from proof** (Implement’s button stays **Reimplement**). That agent reads `derived/proof-report.md` plus the implement brief and must not edit `requirement.md`. **Improve it** stays Ready-only.

## Editing

The RO may edit in the cockpit or in the IDE. The editor lives only on **Define**. It defaults to **Preview** (rendered display), with **Edit** (source) and **Split**. A toolbar inserts markdown markers (bold, italic, heading H1–H6, lists, link) into the source — it does not rewrite the frozen grammar. Saving PUTs markdown and recompiles. A current Jev score becomes stale until Check. Spec section rows and Judgment findings switch to Define and jump to the matching heading, line, or spec ID. **Improve it** writes one opinionated brief for all open findings, then shows Accept/Reject on Define.

## Create

Empty pack folder: next action **Create this requirement** writes [requirement-template.md](requirement-template.md). From the requirement list: create bar asks for a kebab-case id only, writes the same template, then opens the new pack on Define.

The next step is **not** jumping into Business Rules. Define shows an in-stage **What should this requirement cover?** panel. **Start** launches AI authoring (`POST /api/author/start`). `req0 create` on the CLI stays template-only.

### AI authoring

The owner’s job is id + description + answers (and optional PNG/JPG/WebP in `context/`). Req0 compiles between writer turns, and auto-Checks with Jev when a TypeSafe key is set.

- **Quality bar:** with a TypeSafe key (or `REQ0_JEV=mock`), loop until Ready **Clear** (noul ≥ 0.75, zero blockers). Without a key, stop at Spec **Valid**. Ready may stay Not yet. Do not fake Jev.
- **File shape:** frozen grammar (`Overview`, `Business Rules`, `Use Cases`, `Roles & Permissions`, plus the optional headings in [grammar.md](grammar.md)). The starter template’s `## Description` headings are a human checklist, not compile input.
- **Questions:** in-stage on Define, not a chat and not a fifth meter. Recommended choice first (**Suggested**). **Something else** when the agent sets `allowCustom`. Per-question **Skip**, or **Skip all** for the round. Skip is not an answer — the agent must not assume.
- **Artifacts:** optional upload into the pack `context/` folder. Cursor/Copilot **Read** the file. No Req0 vision model, no M5 caption↔spec-ID linking.
- **Apply:** `requirement.md` updates live (no Accept/Reject). Improve it stays Ready-gated with Accept/Reject and must not invent new BR-/UC- IDs. Authoring may assign the **first** IDs in the pack.
- **Stop** keeps the last `requirement.md`. Cap 8 rounds, then Judgment **Improve it** once Ready is blocked.
- Activity for authoring is `authorActivity` on Define. The cockpit still polls `GET /api/state`. `health.json` keys stay `spec` / `ready` / `build` / `proof`.
