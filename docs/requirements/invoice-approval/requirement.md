# Invoice approval

## Overview

Department managers approve supplier invoices for their own department. A manager may approve only if they are the assigned approver and the invoice belongs to their department. Viewers can read invoices but cannot change status. Admins assign an approver; they cannot approve.

## Out of scope

Paying the invoice, purchase-order matching, email notifications, creating invoices, and changing a manager's or invoice's department.

## Entities

A department is a named cost centre. Tests use Finance and Operations.

A manager belongs to exactly one department. The Manager persona is in Finance.

An invoice belongs to exactly one department. It has status Unpaid or Approved, and assignedApprover which is none or one manager. Unpaid means not yet approved.

The assigned approver must be a manager whose department equals the invoice's department. Role-level `approve-invoice` allow for Manager is further restricted by BR-001, BR-004, and BR-005.

## Business Rules

### Assigned manager approves a department invoice

Id: BR-001
Statement: A manager may approve an invoice only if they are its assigned approver and the invoice belongs to their department.
Observable: While logged in as that assigned manager, the Approve control is available on that unpaid invoice, and using it sets status to Approved.

### Viewers cannot approve invoices

Id: BR-002
Statement: A viewer must not approve an invoice.
Observable: While logged in as a viewer, the Approve control is absent or disabled, and posting an approval is rejected. Invoice status is unchanged.

### Admins assign a same-department manager as approver

Id: BR-003
Statement: An admin may assign as approver only a manager whose department equals the invoice's department.
Observable: While logged in as an admin, Assign approver is available on an unpaid invoice; only managers in that invoice's department are selectable; after assignment that manager can complete BR-001. A manager from another department is not listed and cannot be assigned.

### Managers cannot approve another department's invoices

Id: BR-004
Statement: A manager must not approve an invoice whose department is not theirs.
Observable: On an invoice for another department, Approve is absent or disabled for that manager, and posting an approval is rejected. Invoice status is unchanged.

### Managers cannot approve unless they are the assigned approver

Id: BR-005
Statement: A manager must not approve an invoice for which they are not the assigned approver, including when no approver is assigned.
Observable: On an unpaid invoice in their department that is unassigned or assigned to someone else, Approve is absent or disabled for that manager, and posting an approval is rejected. Invoice status is unchanged.

## Use Cases

### Assigned manager approves a department invoice

Id: UC-001
Actor: Manager
Preconditions: The Manager persona (Finance) is logged in. An unpaid Finance invoice exists with this manager as assignedApprover.
Steps:
1. Open the unpaid invoices list
2. Open the invoice
3. Choose Approve
Outcome: Invoice status is Approved.

### Viewer tries to approve

Id: UC-002
Actor: Viewer
Preconditions: The viewer is logged in. An unpaid invoice is visible.
Steps:
1. Open the unpaid invoices list
2. Open the invoice
3. Look for Approve
Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

### Admin assigns a same-department manager

Id: UC-003
Actor: Admin
Preconditions: The admin is logged in. An unpaid Finance invoice has no assignedApprover. A Finance manager and an Operations manager exist.
Steps:
1. Open the invoice
2. Choose Assign approver
3. Select the Finance manager
Outcome: The Finance manager is assignedApprover and can complete UC-001. Operations managers are not selectable and cannot be assigned.

### Manager tries to approve another department's invoice

Id: UC-004
Actor: Manager
Preconditions: The Manager persona (Finance) is logged in. An unpaid Operations invoice is visible.
Steps:
1. Open the unpaid invoices list
2. Open the Operations invoice
3. Look for Approve
Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

### Manager tries to approve when not the assigned approver

Id: UC-005
Actor: Manager
Preconditions: The Manager persona (Finance) is logged in. An unpaid Finance invoice is visible with no assignedApprover.
Steps:
1. Open the unpaid invoices list
2. Open the invoice
3. Look for Approve
Outcome: Approve is not available. Posting an approval is rejected. Invoice status is unchanged.

## Roles & Permissions

| Action | Admin | Manager | Viewer |
| --- | --- | --- | --- |
| view-invoice | allow | allow | allow |
| assign-approver | allow | deny | deny |
| approve-invoice | deny | allow | deny |
