# Requirements document authoring standard

House style for `docs/requirements/<id>/requirement.md`. This file is prose, not a second compiler. Agents **Read** it, satisfy it in substance, and emit Req0’s frozen grammar.

Req0 compiles only these `##` headings. Required: `Business Rules`, `Use Cases`, `Roles & Permissions`. Optional: `Overview`, `Out of scope`, `Open questions`, `Entities`, `UI notes`, `Definitions`, `Data Definition`, `Verification Scenarios`, `Related Requirements`, `Implementation Notes`. IDs are `BR-001` / `UC-001`. Matrix cells are `allow` or `deny`.

Do not emit `REQ_016_…`, `BR_016.1`, Yes/No/Conditional cells, or an `Artifacts/` heading. Screenshots live in the pack’s `context/` folder.

## Title

The `#` title names the problem or capability, not the solution. Avoid “the system shall”.

## Overview

Two to four sentences: who, what capability, what outcome. Not numbered rules. Put the owner’s description here.

## Definitions (optional)

Glossary only. A definition is not a business rule. If a term implies behaviour, write a `BR-` rule.

## Data Definition (optional)

Identify records, uniqueness, and derived fields. Do not hide behaviour here — behaviour is a business rule or use case.

## Business Rules

Each rule is `###` title plus `Id: BR-NNN`, Statement, Observable.

- One atomic rule per ID.
- Statement is a rule, not a wish.
- Observable is what a person or test notices.
- Exceptions are sibling `BR-` rules, not footnotes.
- Association (which user, which record, which role) must be observable, not implied.

## Use Cases

Each use case is `###` title plus `Id: UC-NNN`, Actor, Preconditions, numbered Steps, Outcome. Alternate paths are optional.

- Title names the intent, not a pixel.
- Actor is a matrix column.
- Steps use `Open` / `Choose` / `Look for` / `Select`.
- `Choose` is allow. `Look for` is deny.
- Outcome is what a person sees: status, label, control present / absent / disabled.
- Cover happy path, deny path, and empty or error paths that matter.
- Mention `context/` screenshots from the matching use case (`UC-001__replace-modal.png`). Do not leave behaviour only in the image.

## Roles & Permissions

One markdown table. First column `Action`. Other columns are roles. Cells `allow` or `deny` only.

- Every role and action the spec talks about appears.
- Consistent with the business rules. An allow cell plus a rule that hides or disables a control is consistent — keep the Look-for use case.

## Verification Scenarios (optional)

How a person would check the pack. Every `BR-` and `UC-` should be exercisable. Do not put the only acceptance here if a rule or use case should own it.

## Related Requirements (optional)

Pointers to other packs. Do not restate this pack’s rules.

## Implementation Notes and UI notes (optional)

Hints for builders. **No hidden acceptance.** If a note would fail a test, it belongs in a business rule or use case.

## Out of scope / Open questions / Entities

Optional frozen headings. Out of scope is what this pack does not cover. Open questions are unresolved owner decisions. Entities name things the spec talks about.

## Document checklist

- [ ] Title names the problem, not the solution.
- [ ] Overview is intent, not a rule list.
- [ ] Definitions are glossary; data describes data; neither hides behaviour.
- [ ] Every business rule has a unique `BR-NNN`, Statement, and Observable.
- [ ] Every use case has a unique `UC-NNN`, actor, numbered steps, and observable Outcome.
- [ ] Matrix is complete with `allow` / `deny` only and matches the rules.
- [ ] Deny, empty, and error paths that matter have use cases.
- [ ] Implementation notes do not hide acceptance criteria.
- [ ] Related packs are pointers, not a second spec.
- [ ] Screenshots in `context/` are referenced; they do not introduce unstated behaviour.
