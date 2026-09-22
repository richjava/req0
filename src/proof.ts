import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createPlaywrightDriver, shortError, type CaseObservation, type ProofDriver } from "./browser.js";
import { NOUL_FAIL, NOUL_PASS } from "./gates.js";
import { createMockJevClient, resolveJevClient, type JevClient } from "./jev.js";
import type { Persona, PersonasResult } from "./personas.js";
import type { QaCase, QaPlan } from "./qa-plan.js";
import { specHash } from "./ready.js";
import type { RuntimeFixture } from "./runtime.js";
import { inspectProductRepo } from "./stack.js";
import type {
  CompileResult,
  ProgressFn,
  ProofCaseResult,
  ProofFinding,
  ProofMeter,
  ProofRun,
  ProofVerdict,
  SpecAst,
} from "./types.js";

export type { ProofDriver } from "./browser.js";

export class ProveLockedError extends Error {
  readonly code = "prove_gate";

  constructor(
    message = "Prove is locked until Ready is Ready, Build succeeded, and fixtures/runtime.yaml parses.",
  ) {
    super(message);
    this.name = "ProveLockedError";
  }
}

export function emptyProof(runtime = false, message?: string): ProofMeter {
  return {
    state: "not_yet",
    runtime,
    ...(message ? { message } : {}),
    findings: [],
  };
}

export function evaluateProof(input: {
  spec: SpecAst | null;
  runtime: boolean;
  run: ProofRun | null;
}): ProofMeter {
  if (!input.runtime) return emptyProof(false);
  if (!input.run || !input.spec) return emptyProof(true);
  if (input.run.specHash !== specHash(input.spec)) {
    return {
      state: "stale",
      runtime: true,
      message: "Spec changed after the last proof run.",
      findings: [],
    };
  }
  if (!input.run.boot.ok) {
    return {
      state: "failed",
      runtime: true,
      message: input.run.boot.message ?? "App did not boot or accept deterministic login.",
      failed: 1,
      passed: 0,
      review: 0,
      findings: [
        {
          id: "proof.boot",
          specId: input.spec.requirementId,
          severity: "fail",
          message: input.run.boot.message ?? "App did not boot or accept deterministic login.",
        },
      ],
    };
  }

  const passed = input.run.cases.filter((item) => item.verdict === "pass").length;
  const failed = input.run.cases.filter((item) => item.verdict === "fail").length;
  const review = input.run.cases.filter((item) => item.verdict === "review").length;
  const findings: ProofFinding[] = input.run.cases
    .filter((item) => item.verdict !== "pass")
    .map((item) => ({
      id: `proof.${item.id}`,
      specId: item.id,
      severity: item.verdict === "fail" ? "fail" : "review",
      message: item.message,
      noul: item.noul,
    }));

  const state = failed > 0 ? "failed" : review > 0 ? "needs_review" : "passed";
  return { state, runtime: true, passed, failed, review, findings };
}

export function assertProveAllowed(result: CompileResult): void {
  if (result.health.ready.state !== "ready") {
    throw new ProveLockedError("Prove is locked until Ready is Ready.");
  }
  if (result.health.build.state !== "succeeded") {
    throw new ProveLockedError("Prove is locked until Build succeeded.");
  }
  if (!result.health.proof.runtime) {
    throw new ProveLockedError(
      "Prove is locked without fixtures/runtime.yaml (baseUrl and deterministic login).",
    );
  }
}

export async function provePlan(
  input: {
    spec: SpecAst;
    plan: QaPlan;
    runtime: RuntimeFixture;
    personas: PersonasResult;
    productRoot: string | null;
  },
  deps: {
    driver?: ProofDriver;
    client?: JevClient;
    fetchImpl?: typeof fetch;
    waitForUrl?: (url: string) => Promise<boolean>;
    inspectLogin?: boolean;
    onProgress?: ProgressFn;
    runReset?: (command: string, cwd: string) => Promise<void>;
  } = {},
): Promise<ProofRun> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const waitForUrl = deps.waitForUrl ?? ((url: string) => urlResponds(url, fetchImpl));
  const note = deps.onProgress ?? (() => {});
  const boot = await ensureBaseUrl(input.runtime, input.productRoot, waitForUrl, note, {
    inspectLogin: deps.inspectLogin ?? !deps.waitForUrl,
    fetchImpl,
  });
  if (!boot.ok) {
    return {
      specHash: specHash(input.spec),
      checkedAt: new Date().toISOString(),
      boot,
      cases: [],
    };
  }

  if (input.runtime.resetCommand && !input.productRoot) {
    const message = "resetCommand is set, but there is no product repo root to run it in.";
    note(message, "error");
    return {
      specHash: specHash(input.spec),
      checkedAt: new Date().toISOString(),
      boot: { ok: false, message },
      cases: [],
    };
  }

  const total = input.plan.cases.length;
  note(`App is up. ${total} case${total === 1 ? "" : "s"} in derived/qa-plan.yaml.`);
  let driver: ProofDriver;
  try {
    if (!deps.driver) note("Launching the browser…");
    driver = deps.driver ?? (await createPlaywrightDriver(note));
  } catch (err) {
    const message = shortError(err);
    note(message, "error");
    return {
      specHash: specHash(input.spec),
      checkedAt: new Date().toISOString(),
      boot: { ok: false, message },
      cases: [],
    };
  }
  const client = deps.client ?? (process.env.REQ0_PROOF === "mock" ? createMockJevClient() : resolveJevClient());
  const cases: ProofCaseResult[] = [];

  try {
    for (const [index, qa] of input.plan.cases.entries()) {
      const persona = input.personas.personas.get(qa.actor);
      note(`Case ${index + 1}/${total} — ${qa.id} as ${qa.actor} (${qa.kind}).`);
      if (!persona?.email) {
        const message = `No persona email for actor "${qa.actor}".`;
        note(message, "error");
        cases.push({
          id: qa.id,
          kind: qa.kind,
          verdict: "fail",
          message,
        });
        continue;
      }
      if (input.runtime.resetCommand && input.productRoot) {
        try {
          note(`Resetting fixtures for ${qa.id} (\`${input.runtime.resetCommand}\`)…`);
          await (deps.runReset ?? runResetCommand)(input.runtime.resetCommand, input.productRoot);
        } catch (err) {
          const message = shortError(err);
          note(message, "error");
          cases.push({ id: qa.id, kind: qa.kind, verdict: "fail", message });
          continue;
        }
      }
      note(`Logging in as ${persona.email}…`);
      let observed;
      try {
        observed = await driver.runCase({ runtime: input.runtime, persona, qa });
      } catch (err) {
        const message = shortError(err);
        note(`${qa.id}: ${message}`, "error");
        cases.push({ id: qa.id, kind: qa.kind, verdict: "fail", message });
        continue;
      }
      try {
        const judged = await judgeCase(qa, persona, observed, client, input.spec.requirementId, note);
        note(judged.message, judged.verdict === "fail" ? "error" : judged.verdict === "pass" ? "ok" : "info");
        cases.push(judged);
      } catch (err) {
        const message = shortError(err);
        note(`${qa.id}: ${message}`, "error");
        cases.push({ id: qa.id, kind: qa.kind, verdict: "review", message });
      }
    }
  } finally {
    note("Closing the browser…");
    await driver.close?.();
  }

  return {
    specHash: specHash(input.spec),
    checkedAt: new Date().toISOString(),
    boot: { ok: true },
    cases,
  };
}

export async function persistProofRun(
  paths: { derived: string; proofRun: string },
  run: ProofRun,
): Promise<void> {
  await mkdir(paths.derived, { recursive: true });
  await writeFile(paths.proofRun, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

async function judgeCase(
  qa: QaCase,
  persona: Persona,
  observed: CaseObservation,
  client: JevClient,
  requirementId: string,
  note: ProgressFn,
): Promise<ProofCaseResult> {
  if (observed.error) {
    return { id: qa.id, kind: qa.kind, verdict: "fail", message: observed.error };
  }

  if (qa.kind === "deny") {
    if (!qa.control) {
      return {
        id: qa.id,
        kind: qa.kind,
        verdict: "review",
        message: `${qa.id} deny case has no Choose/Look-for control to check.`,
      };
    }
    const hidden = !observed.controlAvailable || observed.controlDisabled;
    return {
      id: qa.id,
      kind: qa.kind,
      verdict: hidden ? "pass" : "fail",
      message: hidden
        ? `${qa.control} is absent or disabled for ${persona.role}.`
        : `${qa.control} was available and enabled for ${persona.role}; deny failed.`,
    };
  }

  if (qa.control && !observed.clicked) {
    return {
      id: qa.id,
      kind: qa.kind,
      verdict: "fail",
      message: observed.controlAvailable
        ? `${qa.control} was disabled for ${persona.role}.`
        : `${qa.control} was not available for ${persona.role}.`,
    };
  }

  note(`Asking Jev whether ${qa.id} matches the Outcome…`);
  const answers = await withTimeout(
    client.judge({
      requirementId,
      catalog: "m4-proof-v1",
      questions: [
        {
          id: `proof.outcome.${qa.id}`,
          type: "noul",
          specId: qa.id,
          instructions:
            "Does this page observation match the Outcome? Score only clauses that url, text, and options can confirm or contradict. Clauses about later use cases do not lower the score when the visible clauses match.",
          criteria: {
            true: "Every Outcome clause this page can show is true (status, assignedApprover, who is listed in options, visible controls).",
            false: "A checkable Outcome clause is missing or contradicted, or this is the wrong page.",
          },
          state: {
            id: qa.id,
            actor: qa.actor,
            outcome: qa.outcome,
            url: observed.url,
            text: observed.text,
            options: observed.options,
          },
        },
      ],
    }),
    60_000,
    `Jev did not answer ${qa.id} within 60s.`,
  );
  const noul = answers[0]?.noul;
  if (typeof noul !== "number") {
    return {
      id: qa.id,
      kind: qa.kind,
      verdict: "review",
      message: `${qa.id} allow case did not get a noul from Jev.`,
    };
  }
  const verdict: ProofVerdict = noul >= NOUL_PASS ? "pass" : noul <= NOUL_FAIL ? "fail" : "review";
  return {
    id: qa.id,
    kind: qa.kind,
    verdict,
    noul,
    message:
      verdict === "pass"
        ? `${qa.id} outcome matched (noul ${noul.toFixed(2)}).`
        : verdict === "fail"
          ? `${qa.id} outcome did not match (noul ${noul.toFixed(2)}).`
          : `${qa.id} outcome needs review (noul ${noul.toFixed(2)}).`,
  };
}

async function ensureBaseUrl(
  runtime: RuntimeFixture,
  productRoot: string | null,
  waitForUrl: (url: string) => Promise<boolean>,
  note: ProgressFn,
  options: { inspectLogin: boolean; fetchImpl: typeof fetch },
): Promise<{ ok: boolean; message?: string }> {
  const loginUrl = new URL(runtime.login.path, `${runtime.baseUrl}/`).toString();
  note(`Checking ${runtime.baseUrl}…`);
  if (await waitForUrl(runtime.baseUrl)) {
    note(`Already listening at ${runtime.baseUrl}.`);
    if (options.inspectLogin) {
      const login = await inspectLoginPage(loginUrl, options.fetchImpl, note);
      if (!login.ok) return login;
    }
    return { ok: true };
  }
  if (!runtime.startCommand) {
    return {
      ok: false,
      message: `Nothing is listening at ${runtime.baseUrl}. Add startCommand to fixtures/runtime.yaml or start the app.`,
    };
  }
  if (!productRoot) {
    return { ok: false, message: "No product repo root, so startCommand cannot run." };
  }
  note(`Starting the app (\`${runtime.startCommand}\`)…`);
  spawn(runtime.startCommand, {
    cwd: productRoot,
    shell: true,
    detached: true,
    stdio: "ignore",
  }).unref();
  const deadline = Date.now() + 45_000;
  let lastPing = Date.now();
  while (Date.now() < deadline) {
    if (await waitForUrl(runtime.baseUrl)) {
      note(`App responded at ${runtime.baseUrl}.`);
      if (options.inspectLogin) {
        const login = await inspectLoginPage(loginUrl, options.fetchImpl, note);
        if (!login.ok) return login;
      }
      return { ok: true };
    }
    if (Date.now() - lastPing >= 5_000) {
      lastPing = Date.now();
      note(`Still waiting for ${runtime.baseUrl} (${Math.ceil((deadline - Date.now()) / 1000)}s left).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    ok: false,
    message: `startCommand ran but ${runtime.baseUrl} did not respond in time.`,
  };
}

export async function inspectLoginPage(
  loginUrl: string,
  fetchImpl: typeof fetch,
  note: ProgressFn = () => {},
): Promise<{ ok: boolean; message?: string }> {
  note(`Checking login ${loginUrl}…`);
  try {
    const response = await fetchImpl(loginUrl, { redirect: "manual", signal: AbortSignal.timeout(2500) });
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 404 || (response.status >= 400 && /json/i.test(type))) {
      return {
        ok: false,
        message: `${loginUrl} returned HTTP ${response.status}. ${new URL(loginUrl).origin} is answering, but it is not this product's login page. Stop the other process on that port or change fixtures/runtime.yaml baseUrl.`,
      };
    }
    if (response.status >= 400 && response.status !== 401) {
      return { ok: false, message: `${loginUrl} returned HTTP ${response.status}.` };
    }
    note(`Login page responded (${response.status}).`);
    return { ok: true };
  } catch {
    return { ok: false, message: `Could not reach ${loginUrl}.` };
  }
}

async function urlResponds(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(2500) });
    return response.status > 0;
  } catch {
    return false;
  }
}

export async function productRootFor(packRoot: string): Promise<string | null> {
  return (await inspectProductRepo(packRoot)).root;
}

async function runResetCommand(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`resetCommand timed out: ${command}`));
    }, 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`resetCommand exited ${code}.${err.trim() ? ` ${err.trim().slice(0, 400)}` : ""}`));
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
