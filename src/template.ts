import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const STARTER_TEMPLATE_PATH = path.join(PACKAGE_ROOT, "docs/requirement-template.md");

export async function loadStarterRequirement(): Promise<string> {
  return readFile(STARTER_TEMPLATE_PATH, "utf8");
}

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

export const RUNTIME_STUB = `# How Req0 proves this pack. Test-only. Credentials stay in personas.yaml.
baseUrl: http://127.0.0.1:3000
startCommand: npm run dev
resetCommand: npm run db:seed
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: "button[type=submit]"
`;
