import { describe, expect, it } from "vitest";
import { parseRuntimeYaml } from "./runtime.js";

const VALID = `baseUrl: http://127.0.0.1:3000
startCommand: npm run dev
resetCommand: npm run db:seed
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: "button[type=submit]"
`;

describe("parseRuntimeYaml", () => {
  it("parses baseUrl, startCommand, resetCommand, and login selectors", () => {
    const result = parseRuntimeYaml(VALID);
    expect(result).toEqual({
      ok: true,
      runtime: {
        baseUrl: "http://127.0.0.1:3000",
        startCommand: "npm run dev",
        resetCommand: "npm run db:seed",
        login: {
          path: "/login",
          email: "#email",
          password: "#password",
          submit: "button[type=submit]",
        },
      },
    });
  });

  it("fails closed when baseUrl or login fields are missing", () => {
    const result = parseRuntimeYaml("baseUrl: http://localhost:3000\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toBe(false);
    expect(result.findings.some((f) => f.message.includes("login.path"))).toBe(true);
  });

  it("rejects a non-http baseUrl", () => {
    const result = parseRuntimeYaml(`baseUrl: localhost:3000
login:
  path: /login
  email: "#email"
  password: "#password"
  submit: button
`);
    expect(result.ok).toBe(false);
  });
});
