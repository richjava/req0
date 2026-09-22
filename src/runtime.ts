import type { Finding } from "./types.js";

export type RuntimeLogin = {
  path: string;
  email: string;
  password: string;
  submit: string;
};

export type RuntimeFixture = {
  baseUrl: string;
  startCommand?: string;
  resetCommand?: string;
  login: RuntimeLogin;
};

export type RuntimeResult =
  | { ok: true; runtime: RuntimeFixture }
  | { ok: false; missing: true }
  | { ok: false; missing: false; findings: Finding[] };

const TOP = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

export function parseRuntimeYaml(source: string): RuntimeResult {
  const findings: Finding[] = [];
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let baseUrl: string | undefined;
  let startCommand: string | undefined;
  let resetCommand: string | undefined;
  let inLogin = false;
  const login: Partial<RuntimeLogin> = {};

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (inLogin) {
      const nested = raw.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/);
      if (nested) {
        const key = (nested[1] ?? "").toLowerCase();
        const value = unquote((nested[2] ?? "").trim());
        if (key === "path" || key === "email" || key === "password" || key === "submit") {
          login[key] = value;
        } else {
          findings.push({
            line,
            severity: "error",
            message: `Unknown login field "${key}". Use path, email, password, submit.`,
          });
        }
        continue;
      }
      if (!raw.startsWith(" ")) inLogin = false;
      else {
        findings.push({
          line,
          severity: "error",
          message: "Unrecognized runtime.yaml login line. Indent fields two spaces.",
        });
        continue;
      }
    }

    const top = raw.match(TOP);
    if (!top || raw.startsWith(" ")) {
      findings.push({
        line,
        severity: "error",
        message: "Unrecognized runtime.yaml line. Use top-level baseUrl, optional startCommand, optional resetCommand, and login.",
      });
      continue;
    }

    const key = (top[1] ?? "").toLowerCase();
    const value = unquote((top[2] ?? "").trim());
    if (key === "baseurl") {
      baseUrl = value;
      continue;
    }
    if (key === "startcommand") {
      startCommand = value || undefined;
      continue;
    }
    if (key === "resetcommand") {
      resetCommand = value || undefined;
      continue;
    }
    if (key === "login") {
      inLogin = true;
      continue;
    }
    findings.push({
      line,
      severity: "error",
      message: `Unknown runtime field "${key}". Use baseUrl, startCommand, resetCommand, login.`,
    });
  }

  if (!baseUrl) {
    findings.push({
      line: 1,
      severity: "error",
      message: 'fixtures/runtime.yaml must set baseUrl (example: "http://127.0.0.1:3000").',
    });
  } else if (!/^https?:\/\//i.test(baseUrl)) {
    findings.push({
      line: 1,
      severity: "error",
      message: "baseUrl must be an http(s) URL.",
    });
  }

  for (const field of ["path", "email", "password", "submit"] as const) {
    if (!login[field]) {
      findings.push({
        line: 1,
        severity: "error",
        message: `login.${field} is required (a CSS selector, or path for login.path).`,
      });
    }
  }

  if (findings.length) {
    return { ok: false, missing: false, findings };
  }

  return {
    ok: true,
    runtime: {
      baseUrl: baseUrl!.replace(/\/$/, ""),
      ...(startCommand ? { startCommand } : {}),
      ...(resetCommand ? { resetCommand } : {}),
      login: {
        path: login.path!.startsWith("/") ? login.path! : `/${login.path!}`,
        email: login.email!,
        password: login.password!,
        submit: login.submit!,
      },
    },
  };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const comment = value.indexOf(" #");
  return comment >= 0 ? value.slice(0, comment).trim() : value;
}
