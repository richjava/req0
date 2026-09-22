# Requirement grammar

Canonical human file: `docs/requirements/<id>/requirement.md`.

The compiler in `src/compile.ts` is **strict and deterministic**. It does not use Jev or any LLM to parse. Unknown structure is an error with a line number.

## Pack layout

```text
docs/requirements/<requirement-id>/
  requirement.md
  fixtures/personas.yaml
  fixtures/runtime.yaml    # Milestone 4; required to enable Prove (baseUrl + login)
  context/                 # Milestone 5; screenshots
  derived/                 # generated; do not hand-edit
    spec.json
    health.json
    status.md
    implement-brief.md     # Milestone 3
    jev-pack.json          # Milestone 2
    jev-run.json           # cached Jev answers (spec-hash)
    build-run.json         # last implement launch
    qa-plan.yaml           # Milestone 4; compiled from spec.json
    proof-run.json         # last prove run
```

`<requirement-id>` is the folder name: kebab-case `[a-z0-9-]+` (example: `invoice-approval`).

## Headings

- One top-level `#` title.
- Required `##` titles, exact strings:
  - `Business Rules`
  - `Use Cases`
  - `Roles & Permissions`
- Optional `##` titles, exact strings only: `Overview`, `Out of scope`, `Open questions`, `Entities`, `UI notes`.
- Any other `##` is a compile error.

## Business rule

Each rule is `###` title plus fields:

```markdown
### Managers approve invoices in their department

Id: BR-001
Statement: A manager may approve an invoice that belongs to their department.
Observable: While logged in as a manager, the Approve control is available …
```

- `Id` must match `BR-NNN` (three digits).
- `Statement` and `Observable` are required. Observable is what a person or test could notice.

## Use case

```markdown
### Manager approves a department invoice

Id: UC-001
Actor: Manager
Preconditions: The manager is logged in. An unpaid invoice exists in their department.
Steps:
1. Open the unpaid invoices list
2. Open the invoice
3. Choose Approve
Outcome: Invoice status is Approved.
```

- `Id` must match `UC-NNN`.
- `Actor` must be a column in the roles matrix.
- Numbered `Steps` required. `Alternate paths` is optional.
- Frozen step verbs: `Open …`, `Choose …`, `Look for …`, `Select …`. Prove matches Open against visible link names using the step plus preconditions. It does not hard-code product paths or record ids.

## Roles and permissions

One markdown table. First column header must be `Action`. Other headers are role names. Cells are only `allow` or `deny` (lowercase). Blank or `maybe` fails.

```markdown
| Action | Admin | Manager | Viewer |
| --- | --- | --- | --- |
| view-invoice | allow | allow | allow |
| approve-invoice | deny | allow | deny |
```

Action ids: kebab-case or PascalCase (`[A-Za-z][A-Za-z0-9-]*`).

## Spec meter (Milestone 1)

| State | Meaning |
| --- | --- |
| Empty | No useful `requirement.md` yet |
| Drafting | File exists but compile errors or incomplete required content |
| Valid | Zero compile errors, at least one rule, one use case, one matrix row |

Valid means the grammar parsed. It does **not** mean the spec is good enough for an agent. That is the Ready meter (Milestone 2).

Personas may be stubbed while Spec is Valid. Ready requires a persona (`email`) per matrix role in `fixtures/personas.yaml`. That check is deterministic and does not call Jev.

## Runtime fixture (Milestone 4)

Prove is blocked without `fixtures/runtime.yaml`. Missing or invalid file fails closed. Schema:

```yaml
baseUrl: http://127.0.0.1:3000
startCommand: npm run dev   # optional; product-repo root; skipped if baseUrl already responds
resetCommand: npm run db:seed  # optional; product-repo root; runs before each case so later allows do not poison deny fixtures
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: "button[type=submit]"
```

`email` / `password` / `submit` are CSS selectors. Credentials come from the Actor’s persona, not this file. `derived/qa-plan.yaml` is compiled from `spec.json` (one case per use case) and is not hand-edited.

## Golden pack

[requirements/invoice-approval/requirement.md](requirements/invoice-approval/requirement.md) must keep compiling. If the grammar cannot express that example, the grammar is wrong.
