# Cockpit

The Requirement Owner’s home. Launch with `npm start` or `req0 start` from the repo or a pack folder.

**One home, one scoreboard, one next action.** Not a second IDE, not a cloud app.

## Layout (design system)

ClickUp-inspired product chrome — see [design-system.md](design-system.md).

- Light sidebar (`--surface-1`): pack name, sections, findings
- Recessed canvas (`--surface-0`): how-this-is-going, next action, four status pills, raised editor panel (`--surface-2`)

## Health meters

A meter that is not born yet reads **Not yet**, never Fail.

| Meter | Meaning when set | Born in |
| --- | --- | --- |
| Spec | Empty / Drafting / Valid (grammar only) | Milestone 1 |
| Ready | Not yet / Blocked / Ready. Persona blockers do not need Jev. Jev scores need an API key. | Milestone 2 |
| Build | Coding-agent run finished (not “app works”) | Milestone 3 |
| Proof | Browser QA vs the pack | Milestone 4 |

Never collapse these meanings.

Health is also a file: `derived/health.json` and `derived/status.md`. Git, CI (later), and the cockpit must agree.

## Interaction contract

1. Open the cockpit.
2. See health and the single next action.
3. Confirm that action, or edit the spec.
4. Compiler (or later Jev / agent / browser) updates health.
5. The next action changes. The RO does not memorize CLI flags.

After Spec Valid, the next action is **Check this spec with Jev**. Without `TYPESAFE_API_KEY` the click fails closed: Ready stays **Not yet**, and TypeSafe errors surface as a 502 with the server message (no secrets). A matrix role without a persona is a Ready blocker immediately. Blockers sort first; the next action is **Improve** the Jev next-id when one is named. After a passing Jev run, next action becomes **Implement this requirement** and is enabled. Prove stays disabled.

## Editing

The RO may edit in the cockpit or in the IDE. Saving the textarea PUTs markdown and recompiles. Section nav jumps to `##` headings. Findings jump to line numbers or spec IDs. **Improve BR-004** jumps to that ID in the editor.

## Create

Empty pack folder: next action **Create this requirement** writes the template. From repo root with no pack: create bar asks for a kebab-case id.
