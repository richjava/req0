# Untitled Requirement

> **Template guidance**
>
> - **[Required]** — include in every requirement.
> - **[Conditional]** — include when relevant to the requirement.
> - Remove these guidance labels and any unused conditional sections when finalising the requirement.

---

## Description [Required]

Describe the feature and its purpose.

Include:

- What capability is being introduced or changed.
- Where it exists in the application.
- The main user outcome.
- Important high-level boundaries or constraints.

Keep this focused on **what the requirement does**, rather than detailed interaction rules.

---

## Actors and Permissions [Required]

### Actors [Required]

List the roles that directly participate in this requirement.

- `RoleName`
- `RoleName`

Briefly explain why these roles are actors where useful.

### Role Permissions [Required]

Describe what each relevant role can and cannot do.

Explicitly identify important permission differences between roles.

Where permissions are defined by another requirement or shared Roles and Permissions document, reference that source rather than unnecessarily duplicating it.

### Scope [Required]

Define the permission and access boundaries relevant to this requirement.

For example:

- The user must have access to the relevant project/client.
- The feature applies only within a particular page or workflow.
- The requirement does not grant access to other areas of the application.
- Related permissions remain governed elsewhere.

**This requirement does not grant permissions beyond the overarching Roles and Permissions definition.**

---

## Definitions [Conditional]

Include when the requirement introduces terminology, concepts, states, or distinctions that need a precise definition.

### Term Name

Definition of the term.

### Another Term

Definition of the term.

---

## Data Definition [Conditional]

Include when the requirement introduces or modifies structured data.

### Entity / Value Name

Describe the data represented by the requirement.

| Field | Type | Required | Validation |
|---|---|---:|---|
| Field Name | String | Yes | Validation rule |
| Field Name | Integer | No | Validation rule |

Include relevant rules for:

- data types
- required/optional values
- valid ranges
- formats
- units
- defaults
- relationships
- persistence/versioning

Do not include this section when the requirement does not introduce or materially change data.

---

## Business Rules [Required]

Define the complete functional rules of the requirement.

### BR_XXX.1 Rule Name

Describe the rule precisely.

### BR_XXX.2 Rule Name

Describe the next rule.

### BR_XXX.3 Rule Name

Describe the next rule.

Business rules should cover relevant:

- permissions
- visibility
- state changes
- validation
- defaults
- persistence
- versioning
- filtering
- ordering
- limits
- edge cases
- interactions with related features

A business rule should be independently understandable and testable where practical.

---

## State Matrix [Conditional]

Include when behaviour depends on combinations of states or values and a table communicates the rules more clearly than prose.

| State / Condition | Expected Behaviour | Actions Available |
|---|---|---|
| State A | Behaviour | Action |
| State B | Behaviour | Action |
| State C | Behaviour | Action |

The matrix supplements the Business Rules; it does not replace them.

---

## Interaction Synchronisation Matrix [Conditional]

Include when multiple controls or interface elements represent or modify the same underlying value.

| User Interaction | UI Element A | UI Element B | Resulting State |
|---|---|---|---|
| Interaction A | Update | Update | Changed |
| Interaction B | No change | Update | Changed |

For example, this is useful where a map, form fields, selectors, or other controls must remain synchronised.

---

## Examples [Conditional]

Include when examples materially improve understanding of the rules.

### Example 1

Given:

- Condition A
- Condition B

When:

- User performs action

Then:

- Expected result

Examples illustrate the rules but do not override the Business Rules.

---

## Use Cases [Required]

### UC_XXX Use Case Name

**Actors:**

- `RoleName`
- `RoleName`

**Preconditions:**

- Required condition.
- Required condition.

**Goal:**

Describe the outcome the actor is trying to achieve.

**Trigger:**

- Event or user action that starts the use case.

**Main Flow:**

1. User performs an action.
2. System responds.
3. User performs the next action.
4. System completes the operation.

**Postconditions:**

- Expected resulting state.
- Persisted changes, where applicable.

---

### UC_XXX.1 Use Case / Sub-Use Case Name [Conditional]

**Actors:**

- `RoleName`

**Preconditions:**

- Required condition.

**Trigger:**

- Triggering action/event.

**Main Flow:**

1. Step.
2. Step.
3. Step.

**Postconditions:**

- Resulting state.

Repeat for additional use cases as required.

---

## Alternate / Exception Flows [Conditional]

Include when significant alternate or failure paths are easier to understand separately from the main use cases.

### AF_XXX.1 Alternate Flow Name

**Condition:**

Describe when this flow occurs.

**Flow:**

1. System detects the condition.
2. System responds appropriately.
3. User can recover or continue as applicable.

**Result:**

Describe the resulting state.

---

## Event / Response Rules [Conditional]

Include when the requirement contains important event-driven behaviour.

| Event | System Response |
|---|---|
| Event occurs | Expected system response |
| Another event occurs | Expected system response |

This can be useful for notifications, emails, asynchronous operations, state transitions, or interactions involving several components.

---

## Validation [Conditional]

Include as a dedicated section when validation is substantial enough that keeping it only within Business Rules would make the requirement difficult to follow.

| Condition | Valid? | Behaviour |
|---|---:|---|
| Condition A | Yes | Allow operation |
| Condition B | No | Display validation and block operation |

Avoid duplicating simple validation already adequately defined in Business Rules or Data Definition.

---

## Empty States [Conditional]

Include when the requirement defines specific empty-state behaviour.

### Empty State Name

**Condition:**

Describe what makes this state empty.

**Display:**

`Empty-state message`

**Available actions:**

- Action, if applicable.
- No action for read-only roles, if applicable.

Distinguish true empty states from filtered-zero or access-related states where relevant.

---

## Related Requirements [Conditional]

List requirements that this feature depends on, extends, or interacts with.

| Requirement | Relationship |
|---|---|
| `REQ_XXX` | Describe the relationship. |
| `REQ_XXX` | Describe the relationship. |

Do not duplicate rules owned by another requirement unless the context is necessary to understand this requirement.

---

## Out of Scope [Conditional]

Explicitly identify closely related behaviour that is intentionally not part of this requirement.

- Out-of-scope behaviour.
- Functionality governed by another requirement.
- Future functionality not included in this iteration.