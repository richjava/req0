import { describe, expect, it } from "vitest";
import { missingPersonaRoles, parsePersonasYaml } from "./personas.js";
import type { SpecAst } from "./types.js";

const spec = {
  requirementId: "x",
  title: "X",
  optional: {},
  businessRules: [],
  useCases: [],
  matrix: { roles: ["Admin", "Viewer"], actions: [] },
} as SpecAst;

describe("parsePersonasYaml", () => {
  it("reads the documented map", () => {
    const result = parsePersonasYaml(`# comment
personas:
  Admin:
    email: admin@example.test
    password: secret
  Viewer:
    email: viewer@example.test
`);
    expect(result.missingFile).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.personas.get("Admin")?.email).toBe("admin@example.test");
    expect(missingPersonaRoles(spec, result)).toEqual([]);
  });

  it("flags a matrix role without a persona", () => {
    const result = parsePersonasYaml(`personas:
  Admin:
    email: admin@example.test
`);
    expect(missingPersonaRoles(spec, result)).toEqual(["Viewer"]);
  });

  it("rejects a missing email", () => {
    const result = parsePersonasYaml(`personas:
  Admin:
    password: only
`);
    expect(result.findings.some((f) => f.message.includes("missing email"))).toBe(true);
  });
});
