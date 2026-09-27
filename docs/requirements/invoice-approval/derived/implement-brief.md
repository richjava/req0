# Implement: Invoice approval

Portable coding-agent brief. Read this file, then the compiled `derived/spec.json`. Do not invent rule, use-case, or role IDs.

## Stack

This product repo is empty (no customer app at the repo root). Ask the Requirement Owner which stack to use. Default: Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth. AWS option: Amplify Gen 2, Next.js, Cognito, Data, S3 (id amplify-gen2). Record the choice in req0.json at the repo root so later requirements stay consistent. Req0's own CLI package.json does not count as a customer app. Adapter: manual.

Default stack (empty repo only): Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth.

## Overview

Department managers approve supplier invoices for their own department. A manager may approve only if they are the assigned approver and the invoice belongs to their department. Viewers can read invoices but cannot change status. Admins assign an approver; they cannot approve.

## Out of scope

Paying the invoice, purchase-order matching, email notifications, creating invoices, and changing a manager's or invoice's department.

## Acceptance criteria (business rules)

Each rule is an acceptance criterion. Implement the Observable, not a paraphrase.

### BR-001 — Assigned manager approves a department invoice

- Statement: A manager may approve an invoice only if they are its assigned approver and the invoice belongs to their department.
- Observable: While logged in as that assigned manager, the Approve control is available on that unpaid invoice, and using it sets status to Approved.

### BR-002 — Viewers cannot approve invoices

- Statement: A viewer must not approve an invoice.
- Observable: While logged in as a viewer, the Approve control is absent or disabled, and posting an approval is rejected. Invoice status is unchanged.

### BR-003 — Admins assign a same-department manager as approver

- Statement: An admin may assign as approver only a manager whose department equals the invoice's department.
- Observable: While logged in as an admin, Assign approver is available on an unpaid invoice; only managers in that invoice's department are selectable; after assignment that manager can complete BR-001. A manager from another department is not listed and cannot be assigned.

### BR-004 — Managers cannot approve another department's invoices

- Statement: A manager must not approve an invoice whose department is not theirs.
- Observable: On an invoice for another department, Approve is absent or disabled for that manager, and posting an approval is rejected. Invoice status is unchanged.

### BR-005 — Managers cannot approve unless they are the assigned approver

- Statement: A manager must not approve an invoice for which they are not the assigned approver, including when no approver is assigned.
- Observable: On an unpaid invoice in their department that is unassigned or assigned to someone else, Approve is absent or disabled for that manager, and posting an approval is rejected. Invoice status is unchanged.

## Flows (use cases)

### UC-001 — Assigned manager approves a department invoice

- Actor: Manager
- Preconditions: The Manager persona (Finance) is logged in. An unpaid Finance invoice exists with this manager as assignedApprover.
- Steps:
  1. Open the unpaid invoices list
  2. Open the invoice
  3. Choose Approve
- Outcome: Invoice status is Approved.

### UC-002 — Viewer tries to approve

- Actor: Viewer
- Preconditions: The viewer is logged in. An unpaid invoice is visible.
- Steps:
  1. Open the unpaid invoices list
  2. Open the invoice
  3. Look for Approve
- Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

### UC-003 — Admin assigns a same-department manager

- Actor: Admin
- Preconditions: The admin is logged in. An unpaid Finance invoice has no assignedApprover. A Finance manager and an Operations manager exist.
- Steps:
  1. Open the invoice
  2. Choose Assign approver
  3. Select the Finance manager
- Outcome: The Finance manager is assignedApprover and can complete UC-001. Operations managers are not selectable and cannot be assigned.

### UC-004 — Manager tries to approve another department's invoice

- Actor: Manager
- Preconditions: The Manager persona (Finance) is logged in. An unpaid Operations invoice is visible.
- Steps:
  1. Open the unpaid invoices list
  2. Open the Operations invoice
  3. Look for Approve
- Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

### UC-005 — Manager tries to approve when not the assigned approver

- Actor: Manager
- Preconditions: The Manager persona (Finance) is logged in. An unpaid Finance invoice is visible with no assignedApprover.
- Steps:
  1. Open the unpaid invoices list
  2. Open the invoice
  3. Look for Approve
- Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

## Authorization (roles and permissions)

| Action | Admin | Manager | Viewer |
| --- | --- | --- | --- |
| view-invoice | allow | allow | allow |
| assign-approver | allow | deny | deny |
| approve-invoice | deny | allow | deny |

Permission checks belong on the server, not only hidden buttons.

## Personas (test only)

Never production credentials. Seed these users so role QA can log in later.

- Admin: admin@example.test
- Manager: manager@example.test
- Viewer: viewer@example.test

Passwords and extras: `fixtures/personas.yaml`.

## Entities

A department is a named cost centre. Tests use Finance and Operations.

A manager belongs to exactly one department. The Manager persona is in Finance.

An invoice belongs to exactly one department. It has status Unpaid or Approved, and assignedApprover which is none or one manager. Unpaid means not yet approved.

The assigned approver must be a manager whose department equals the invoice's department. Role-level `approve-invoice` allow for Manager is further restricted by BR-001, BR-004, and BR-005.

## Product README

Write `README.md` at the product repo root so a stranger can run the app. If a README already exists, update the setup section. Use this requirement's title and the pack paths below. Do not invent a product name.

~~~~markdown
# Invoice approval

Department managers approve supplier invoices for their own department. A manager may approve only if they are the assigned approver and the invoice belongs to their department. Viewers can read invoices but cannot change status. Admins assign an approver; they cannot approve.

## Stack

Next.js App Router, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, Better Auth.

## Setup

1. Copy `.env.example` to `.env` and fill the names in that file.
2. Seed fixture data:

```bash
npm run db:seed
```

3. Start the app:

```bash
npm run dev
```

Login personas are in `docs/requirements/invoice-approval/fixtures/personas.yaml`.

Req0 runtime: `docs/requirements/invoice-approval/fixtures/runtime.yaml`.

~~~~

## Pack files

- Seed the app from existing `fixtures/personas.yaml`. Do not add roles. Do not invent emails.
- `fixtures/runtime.yaml` may be a stub. Set `baseUrl`, `startCommand`, and `resetCommand` to the app you started. Keep login selectors unless you change `/login` to match — then change both.
- Write or update the product-repo `.env.example` with variable names only. No real keys.
- Write `README.md` at the product repo root using the Product README section. Use this requirement's title and pack paths. Do not invent a product name.
- The seed/reset script command must match `runtime.yaml` `resetCommand`.
- First-party `/login` must match those selectors.

## Security baseline

- No production credentials in the spec or this brief.
- Secrets via environment variables.
- Personas are test-only.

## Done means

The app exists in the recorded stack. Personas are seeded. `fixtures/runtime.yaml` matches that app. Product `.env.example` has names only. Product `README.md` has setup for this stack.
A coding-agent run finishing is **Build Succeeded**, not “the app boots.” Boot and login are Proof (Milestone 4).

