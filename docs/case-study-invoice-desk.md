# Case study: proving Invoice Desk

Invoice Desk is the first product Req0 proved end-to-end. The requirement pack is `invoice-approval`. This note is how **this implementation** was judged — not a second copy of the spec.

Pack (live): `docs/requirements/invoice-approval/` in the Invoice Desk repo.  
Req0 golden fixture: `docs/requirements/invoice-approval/` in the Req0 repo.

Last recorded Prove (`derived/proof-run.json`): **2026-09-22T11:02:46.802Z**. All five use cases **pass**.

---

## What is proven, and what is not

Req0 Prove compiles **use cases**, not business rules, into `derived/qa-plan.yaml`. Each UC is one browser case. Rules are covered only through the UC that makes them observable:

| Rule | Proven by | How |
| --- | --- | --- |
| BR-001 Assigned manager may approve | UC-001 | Allow + Jev |
| BR-002 Viewer must not approve | UC-002 | Deny, no Jev |
| BR-003 Admin assigns same-department manager | UC-003 | Allow + Jev |
| BR-004 Manager must not approve another department | UC-004 | Deny, no Jev |
| BR-005 Manager must not approve if not assigned | UC-005 | Deny, no Jev |

The Roles & Permissions cell `approve-invoice` / Manager = allow is exercised by UC-001. Viewer deny is UC-002. **There is no Prove case** that an Admin cannot approve (matrix deny). Admin is only driven through UC-003 (assign).

Deny Outcomes also say “posting an approval is rejected.” Prove **does not POST**. The deny proof is: the Approve **button** is absent or disabled. Server rejection is not executed.

UC-003’s Outcome includes “can complete UC-001.” Prove does **not** then log in as Manager and approve. Jev is told not to lower the score for later-use-case clauses if the visible clauses match.

---

## Jev has two jobs. Only one of them is implementation proof.

### 1. Spec coaching (Ready) — catalog `m2-authoring-v1`

Run by **Check this spec with Jev**, not by Prove. Jev never sees the app. It judges the compiled spec:

- Per rule `rule.observable.BR-NNN`: is Statement observable via Observable?
- Per use case `usecase.contradicts.UC-NNN`: does this contradict the matrix for its Actor?
- Per section score (Business Rules / Use Cases / Roles & Permissions)
- One choice: which ID to improve next
- Pack noul: safe to hand to a coding agent?

That decides **Ready**, not Proof.

### 2. Implementation proof (Prove) — catalog `m4-proof-v1`

Jev is called **only for allow cases** (UC-001, UC-003), after Playwright has clicked the control. Deny cases (UC-002, UC-004, UC-005) never call Jev.

Endpoint: `POST https://api.typesafe.ai/v1/systemone`  
Model: `jev-latest`  
Auth: `Bearer TYPESAFE_API_KEY`

Envelope:

```json
{
  "model": "jev-latest",
  "state": {
    "catalog": "m4-proof-v1",
    "requirementId": "invoice-approval",
    "items": {
      "proof.outcome.UC-00N": { "id": "UC-00N", "actor": "…", "outcome": "…", "url": "…", "text": "…", "options": [] }
    }
  },
  "questions": {
    "proof.outcome.UC-00N": {
      "type": "noul",
      "instructions": "Does this page observation match the Outcome? Score only clauses that url, text, and options can confirm or contradict. Clauses about later use cases do not lower the score when the visible clauses match.",
      "criteria": {
        "true": "Every Outcome clause this page can show is true (status, who is assigned or selected, who is listed in options, visible controls).",
        "false": "A checkable Outcome clause is missing or contradicted, or this is the wrong page."
      }
    }
  }
}
```

Gate: noul ≥ **0.75** pass, ≤ **0.15** fail, else needs review.

`text` is the page’s visible copy (capped), prefixed with `Selectable options: …` when a `<select>` was present. `options` is that dropdown’s labels (captured **before** the allow click). Jev does not get screenshots, HTML, or network traces.

---

## Shared execution (every case)

Before **each** case:

1. `resetCommand`: `npm run db:seed` in the Invoice Desk repo (so UC-001’s Approve does not leave UC-005 with no unassigned invoice).
2. Playwright: new browser context, open `http://localhost:3000/login`.
3. Fill `#email` / `#password` from `fixtures/personas.yaml`, click `button[type=submit]`. No Jev at login.

Seeded unpaid invoices after reset:

| Number | Department | Assigned approver | Used by |
| --- | --- | --- | --- |
| INV-FIN-001 | Finance | Finance Manager (`manager@example.test`) | UC-001 |
| INV-FIN-002 | Finance | none | UC-003, UC-005 |
| INV-OPS-001 | Operations | Operations Manager | UC-004 |

Open does not hard-code those numbers. It scores **visible link text** against the Open step plus preconditions that mention the same head noun (`invoice`). “An Operations manager exists” is ignored when opening an invoice.

After login the app lands on the unpaid list (`/invoices`). “Open the unpaid invoices list” stays there unless a matching nav link exists.

---

## UC-001 — Assigned manager approves (allow)

**Proves BR-001.** Actor Manager → `manager@example.test`. Control: **Approve**.

| Step | What executed |
| --- | --- |
| Reset | `npm run db:seed` |
| Login | Manager |
| Open the unpaid invoices list | Already on `/invoices` |
| Open the invoice | Preconditions require an unpaid **Finance** invoice with this manager **as assignedApprover** → list row **INV-FIN-001** (`Approver: Finance Manager`) |
| Choose Approve | Button `Approve` must be visible and enabled; click; wait for `Approving…` to hide; wait until page text changes |

If Approve is missing or disabled, the case **fails here**. Jev is not asked.

If the click ran, Jev question `proof.outcome.UC-001` with:

- **outcome:** `Invoice status is Approved.`
- **actor:** Manager
- **url:** `/invoices/:id` after Approve
- **text:** page copy (expect Status **Approved**)
- **options:** usually empty (no manager `<select>` on this page)

Last run: **pass**, noul **0.93**.

---

## UC-002 — Viewer tries to approve (deny)

**Proves BR-002.** Actor Viewer → `viewer@example.test`. Control: **Approve**. **Jev is not called.**

| Step | What executed |
| --- | --- |
| Reset | `npm run db:seed` |
| Login | Viewer |
| Open the unpaid invoices list | Stay on list |
| Open the invoice | Preconditions: an unpaid invoice is visible → first matching row (typically INV-FIN-001) |
| Look for Approve | Count button named `Approve`. Pass if count is 0 **or** the button is disabled |

Judgement (deterministic):

```
hidden = !controlAvailable || controlDisabled
pass  if hidden
fail  if Approve is present and enabled
```

Last run: **pass** — `Approve is absent or disabled for Viewer.`

---

## UC-003 — Admin assigns a same-department manager (allow)

**Proves BR-003.** Actor Admin → `admin@example.test`. Control: **Assign approver**.

| Step | What executed |
| --- | --- |
| Reset | `npm run db:seed` |
| Login | Admin |
| Open the invoice | Preconditions: unpaid **Finance** invoice with **no assignedApprover**. The sentence “a Finance manager and an Operations manager exist” does not contain `invoice`, so it is not used for picking → **INV-FIN-002** (`No approver assigned`) |
| Select the Finance manager | First `<select>` on the page; option whose label matches “Finance manager” (seeded `Finance Manager (manager@example.test)`). Operations must not be in that list if the app is correct |
| Choose Assign approver | Click enabled **Assign approver**; wait for `Assigning…`; wait until page text changes |

Options are snapshotted **before** the click (who was selectable). After click, `text` should show the Finance manager as assigned, not `None`.

Jev question `proof.outcome.UC-003` with:

- **outcome:** `The Finance manager is assignedApprover and can complete UC-001. Operations managers are not selectable and cannot be assigned.`
- **actor:** Admin
- **options:** e.g. `["Finance Manager (manager@example.test)"]` — this is the evidence that Operations is not selectable
- **text:** includes `Selectable options: …` plus Assigned approver / status

Jev is instructed **not** to require that UC-001 has already been re-run on this page.

Last run: **pass**, noul **0.79**.

---

## UC-004 — Manager, other department (deny)

**Proves BR-004.** Actor Manager. Control: **Approve**. **Jev is not called.**

| Step | What executed |
| --- | --- |
| Reset | `npm run db:seed` |
| Login | Manager (Finance) |
| Open the unpaid invoices list | Stay on list |
| Open the Operations invoice | Step modifier **Operations** → **INV-OPS-001** |
| Look for Approve | Same deny check as UC-002 |

Last run: **pass** — `Approve is absent or disabled for Manager.`

---

## UC-005 — Manager, not the assigned approver (deny)

**Proves BR-005.** Actor Manager. Control: **Approve**. **Jev is not called.**

| Step | What executed |
| --- | --- |
| Reset | `npm run db:seed` (restores INV-FIN-002 unassigned after UC-001/UC-003) |
| Login | Manager (Finance) |
| Open the unpaid invoices list | Stay on list |
| Open the invoice | Unpaid Finance invoice with **no assignedApprover** → **INV-FIN-002** |
| Look for Approve | Deny check: Approve must be absent or disabled |

Last run: **pass** — `Approve is absent or disabled for Manager.`

---

## Order and isolation

Cases run in spec order: UC-001 → UC-005. Allow cases mutate the database (approve, assign). Without per-case seed, UC-005 opened an assigned invoice and Approve was correctly enabled — a false deny failure. `resetCommand` before every case is part of the proof, not a convenience.

---

## Artifacts

| File | Role |
| --- | --- |
| `requirement.md` | Human spec (source of truth) |
| `fixtures/personas.yaml` | Who logs in |
| `fixtures/runtime.yaml` | `baseUrl`, login selectors, `startCommand`, `resetCommand` |
| `derived/qa-plan.yaml` | Compiled cases Prove actually runs |
| `derived/proof-run.json` | Last verdicts + noul |
| `derived/proof-report.md` | Same run, written for a QA reader |
| `derived/prove-run.log` | Activity lines (boot, login, Jev, errors) |
| `derived/jev-run.json` | Spec-coaching answers (Ready), not Prove |
