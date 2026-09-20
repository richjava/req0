import type { Finding, SpecAst } from "./types.js";

export type Persona = {
  role: string;
  email: string;
  password?: string;
};

export type PersonasResult = {
  personas: Map<string, Persona>;
  findings: Finding[];
  missingFile: boolean;
};

const ROLE_LINE = /^ {2}([^:\s][^:]*):[ \t]*$/;
const FIELD_LINE = /^ {4}([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

export function parsePersonasYaml(source: string): PersonasResult {
  const findings: Finding[] = [];
  const personas = new Map<string, Persona>();
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  let started = false;
  let current: { role: string; email?: string; password?: string; line: number } | null = null;

  const flush = () => {
    if (!current) return;
    if (!current.email) {
      findings.push({
        line: current.line,
        severity: "error",
        message: `Persona "${current.role}" is missing email.`,
      });
    } else {
      personas.set(current.role, {
        role: current.role,
        email: current.email,
        password: current.password,
      });
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!started) {
      if (trimmed === "personas:" || trimmed === "personas") {
        started = true;
        continue;
      }
      findings.push({
        line,
        severity: "error",
        message: `fixtures/personas.yaml must start with a top-level "personas:" map (got "${trimmed}").`,
      });
      return { personas, findings, missingFile: false };
    }

    const role = raw.match(ROLE_LINE);
    if (role) {
      flush();
      const name = (role[1] ?? "").trim();
      if (!name) {
        findings.push({ line, severity: "error", message: "Persona role name cannot be blank." });
        continue;
      }
      if (personas.has(name)) {
        findings.push({ line, severity: "error", message: `Duplicate persona "${name}".` });
      }
      current = { role: name, line };
      continue;
    }

    const field = raw.match(FIELD_LINE);
    if (field && current) {
      const key = (field[1] ?? "").toLowerCase();
      const value = (field[2] ?? "").trim();
      if (key === "email") current.email = value;
      else if (key === "password") current.password = value;
      continue;
    }

    findings.push({
      line,
      severity: "error",
      message:
        "Unrecognized personas.yaml line. Use a role at 2-space indent and email/password at 4-space indent.",
    });
  }

  flush();

  if (!started) {
    findings.push({
      line: 1,
      severity: "error",
      message: 'fixtures/personas.yaml must contain a top-level "personas:" map.',
    });
  }

  return { personas, findings, missingFile: false };
}

export function missingPersonaRoles(spec: SpecAst, personas: PersonasResult): string[] {
  return spec.matrix.roles.filter((role) => !personas.personas.has(role));
}
