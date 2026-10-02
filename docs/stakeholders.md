# Stakeholders and the Requirement Owner

The unit of work is a **requirement**, not a job title. Req0 is built so one person can be accountable from definition through proof. Companies may still have four specialists; they use the same pack in sequence.

## Requirement Owner (RO)

Accountable for one requirement through definition, design intent, implementation kickoff, and (later) proof. They live in the [cockpit](cockpit.md): one home, one scoreboard, one next action.

They do not need to be an expert in every craft. The tool makes the crafts available as **modes**.

## Modes

### Product Owner

Writes business rules and use cases once. Status is the Spec (and later Proof) meter, not “dev said it’s done.” Open questions stay in the spec.

### UX Designer

Use cases and the permission matrix are the interaction contract. Optional `UI notes` live in the spec. Screenshots come in Milestone 5 (`context/`), captioned by the RO — Jev cannot see images.

### Developer

No ticket archaeology. A portable `derived/implement-brief.md` briefs whichever coding agent is configured. Cursor, Copilot, Claude Code, and Codex CLI are adapters; `--adapter=manual` works for any coding agent. Launch stays gated on Ready. The developer will review diffs against named IDs (`BR-003`). Matching an existing repo is the agent’s job.

### QA Analyst

Stops rewriting the spec as a separate test suite. Proof runs from the same pack (personas, use cases, matrix, runtime). Failures cite `UC-` IDs. The last run is `derived/proof-report.md`.

## What we will not do

We will not publish an org-change playbook. The software must work if four people share a pack **or** if one RO walks the whole path.
