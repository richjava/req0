export const EMPTY_TEMPLATE = `# Untitled requirement

## Overview

What problem does this requirement solve?

## Business Rules

### Rule title

Id: BR-001
Statement:
Observable:

## Use Cases

### Use case title

Id: UC-001
Actor:
Preconditions:
Steps:
1.
Outcome:

## Roles & Permissions

| Action | RoleA |
| --- | --- |
| example-action | allow |
`;

export const PERSONAS_STUB = `# Test-only personas. Never production credentials.
personas:
  RoleA:
    email: rolea@example.test
    password: test-only-not-production
`;
