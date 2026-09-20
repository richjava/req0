# Req0 documentation

This `docs/` tree has two different jobs. Do not mix them.

| Path | What it is |
| --- | --- |
| [docs/](.) **product guides** (this folder’s markdown files) | How Req0 works, for people building or using the tool |
| [requirements/](requirements/) | Requirement **packs** the tool compiles. Sample/input data, not manuals |

The golden fixture used in tests is [requirements/invoice-approval/](requirements/invoice-approval/). `req0 start` and `req0 compile` only look under `docs/requirements/`, never at these product guides.

## For stakeholders

- [Product overview](product.md) — what Req0 is, and what it is not
- [Stakeholders and the Requirement Owner](stakeholders.md) — who uses it and how roles map
- [Roadmap](roadmap.md) — milestones, current status, fences
- [Glossary](glossary.md) — shared language

## For people writing requirements

- [Requirement grammar](grammar.md) — frozen `requirement.md` format
- [Cockpit](cockpit.md) — the Requirement Owner home, meters, next action

## For people building Req0

- [Architecture](architecture.md) — compiler, cockpit, later Jev and coding-agent layers
- [Design system](design-system.md) — locked ClickUp-inspired UI tokens and classes

## Status

**Shipped:** Milestone 1 (spec pack, compiler, local cockpit), the cockpit design-system restyle, Milestone 2 (personas, `jev-pack.json`, Ready meter, live TypeSafe check), and Milestone 3 (implement brief, Cursor + manual adapters, Implement gated on Ready).

**Not shipped:** Browser proof (M4) and later milestones. Those are specified in the roadmap so we do not invent them ad hoc.
