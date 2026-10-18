# Requirement pack standard

House style for a pack under `docs/requirements/<id>/`. This file is prose, not a second compiler. Agents **Read** it, satisfy it in substance, and keep Req0’s folder layout and frozen `requirement.md` grammar.

## Folder

```text
docs/requirements/<kebab-id>/
  requirement.md          # canonical spec; humans and agents write this
  fixtures/personas.yaml  # test users per matrix role, never production credentials
  fixtures/runtime.yaml   # Prove: app URL and login selectors
  context/                # optional screenshots the authoring agent can Read
  derived/                # generated; do not hand-edit
```

`<kebab-id>` is the folder name (`invoice-approval`). Do not invent a parallel `Artifacts/` tree or `REQ_016_…` filenames.

## Canonical file

`requirement.md` is the spec. Screenshots illustrate. If behaviour appears only in an image, write it into a business rule or use case.

## context/ artifacts

- PNG, JPG, or WebP.
- Name `{UC-id}__{purpose}.{ext}` (example: `UC-001__replace-modal.png`).
- Every file is referenced from the matching use case (or Overview if it is pack-level context).
- Keep artifacts current. A renamed use case needs a renamed or updated screenshot.
- A mock is not a screenshot of production. Say which it is in the use case or Overview.

## Observability of association

Rules and outcomes must make the link between actor, record, and permission noticeable. “The right user sees the right invoice” is not observable until the Observable says how.

## Completeness

A pack that is safe to hand to an agent has:

- Roles in the matrix, each with a persona when Ready is the bar
- Business rules with Observables
- Use cases for allow and deny paths that matter
- A matrix that does not contradict those use cases
- Artifacts that exist, are named, and are referenced
- No behaviour that lives only in Implementation Notes or a screenshot

## Pack checklist

- [ ] Folder matches `docs/requirements/<id>/` with `requirement.md` and `context/` (not `Artifacts/`).
- [ ] `requirement.md` is canonical; screenshots do not introduce unstated behaviour.
- [ ] `context/` files use `{UC-id}__{purpose}.ext` and are referenced.
- [ ] Referenced artifacts still match the use cases they illustrate.
- [ ] Association between user, record, and role is observable in rules or outcomes.
- [ ] Every `BR-` and `UC-` is exercisable through use cases or verification scenarios.
- [ ] Implementation notes are hints, not a second acceptance list.
- [ ] Personas and runtime fixtures stay in `fixtures/`, not in the spec.
