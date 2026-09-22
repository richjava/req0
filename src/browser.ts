import { access } from "node:fs/promises";
import type { Persona } from "./personas.js";
import type { QaCase } from "./qa-plan.js";
import type { RuntimeFixture } from "./runtime.js";
import type { ProgressFn } from "./types.js";

export type CaseObservation = {
  url: string;
  text: string;
  options: string[];
  controlAvailable: boolean;
  controlDisabled: boolean;
  clicked: boolean;
  error?: string;
};

export type ProofDriver = {
  runCase(input: {
    runtime: RuntimeFixture;
    persona: Persona;
    qa: QaCase;
  }): Promise<CaseObservation>;
  close?(): Promise<void>;
};

export async function createPlaywrightDriver(onProgress?: ProgressFn): Promise<ProofDriver> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error('Playwright is not installed. From the Req0 repo run "npm install" then "npx playwright install chromium".');
  }

  const browser = await launchChromium(playwright, onProgress);
  return {
    async close() {
      await browser.close();
    },
    async runCase({ runtime, persona, qa }) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      try {
        const loginUrl = new URL(runtime.login.path, `${runtime.baseUrl}/`).toString();
        await page.goto(loginUrl, { waitUntil: "load", timeout: 20_000 });
        const loginError = await submitLogin(page, runtime, persona);
        if (loginError) {
          return emptyObservation(page.url(), loginError);
        }

        for (const step of qa.steps) {
          if (/^open\b/i.test(step)) {
            const opened = await openTarget(page, step, qa.preconditions);
            if (!opened) {
              return emptyObservation(page.url(), `Could not follow: ${step}`);
            }
          }
        }
        for (const step of qa.steps) {
          if (!/^select\b/i.test(step)) continue;
          const selectError = await applySelect(page, step);
          if (selectError) {
            return emptyObservation(page.url(), selectError);
          }
        }
        const listedOptions = await page
          .locator("select option")
          .allInnerTexts()
          .then((items) => items.map((item) => item.trim()).filter(Boolean))
          .catch(() => [] as string[]);

        const control = qa.control
          ? page.getByRole("button", { name: new RegExp(`^${escapeRegExp(qa.control)}$`, "i") })
          : null;
        const controlCount = control ? await control.count() : 0;
        const controlAvailable = controlCount > 0;
        const controlDisabled = controlAvailable ? await control!.first().isDisabled() : false;

        let clicked = false;
        if (qa.kind === "allow" && control && controlAvailable && !controlDisabled) {
          await control.first().click();
          clicked = true;
          await settleAfterAllow(page, qa);
        }

        const seen = await observe(page, qa.control);
        const options = listedOptions.length ? listedOptions : seen.options;
        const prefix = options.length ? `Selectable options: ${options.join("; ")}. ` : "";
        return {
          ...seen,
          text: `${prefix}${seen.text}`.slice(0, 4000),
          options,
          controlAvailable,
          controlDisabled,
          clicked,
        };
      } catch (err) {
        return emptyObservation(page.url(), shortError(err));
      } finally {
        await context.close();
      }
    },
  };
}

async function submitLogin(
  page: import("playwright").Page,
  runtime: RuntimeFixture,
  persona: Persona,
): Promise<string | null> {
  const email = page.locator(runtime.login.email);
  const password = page.locator(runtime.login.password);
  const submit = page.locator(runtime.login.submit);
  await email.waitFor({ state: "visible" });
  await waitForReactField(email);
  await fillControlled(email, persona.email);
  await fillControlled(password, persona.password ?? "");
  if ((await email.inputValue()) !== persona.email) {
    return `Login form did not keep ${persona.email} (saw "${await email.inputValue()}").`;
  }
  await submit.click();

  await Promise.race([
    page.waitForURL((url) => !isLoginUrl(String(url), runtime), { timeout: 15_000 }),
    email.waitFor({ state: "hidden", timeout: 15_000 }),
  ]).catch(() => {});

  const stillOnLogin = isLoginUrl(page.url(), runtime) && (await email.count()) > 0;
  if (!stillOnLogin) return null;

  const body = ((await page.locator("body").innerText().catch(() => "")) ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  if (new URL(page.url()).search === "?") {
    return `Deterministic login for ${persona.email} never ran the sign-in script (the form did a plain HTML GET). fixtures/runtime.yaml baseUrl must match the origin you use in the browser — localhost and 127.0.0.1 are different.`;
  }
  return `Deterministic login failed for ${persona.email}. ${body}`;
}

function isLoginUrl(url: string, runtime: RuntimeFixture): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "") || "/";
    const login = new URL(runtime.login.path, `${runtime.baseUrl}/`).pathname.replace(/\/$/, "") || "/";
    return path === login;
  } catch {
    return url.includes(runtime.login.path);
  }
}

async function waitForReactField(locator: import("playwright").Locator): Promise<void> {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate(`(el) => {
    const deadline = Date.now() + 10000;
    const ready = () => Object.keys(el).some((key) => key.startsWith("__reactFiber") || key.startsWith("__reactProps"));
    if (ready()) return;
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (ready()) {
          resolve(undefined);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Login form did not hydrate."));
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }`);
}

async function fillControlled(locator: import("playwright").Locator, value: string): Promise<void> {
  await locator.evaluate(
    `(el, next) => {
      const input = el;
      input.setAttribute("autocomplete", "off");
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto && proto.set && proto.set.call(input, next);
      const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps"));
      const props = propsKey ? input[propsKey] : undefined;
      const event = new Event("input", { bubbles: true });
      Object.defineProperty(event, "target", { writable: false, value: input });
      Object.defineProperty(event, "currentTarget", { writable: false, value: input });
      input.dispatchEvent(event);
      try {
        if (props && props.onChange) props.onChange(event);
      } catch (err) {}
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }`,
    value,
  );
  if ((await locator.inputValue()) === value) return;
  await locator.click();
  await locator.fill(value);
}

async function settleAfterAllow(
  page: import("playwright").Page,
  qa: QaCase,
): Promise<void> {
  const pending = page.getByRole("button", { name: /^(Approving|Assigning)/i });
  await pending.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  await pending.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  if (/approve/i.test(qa.control ?? "")) {
    await page.getByText("Approved", { exact: true }).waitFor({ timeout: 8_000 }).catch(() => {});
  }
  if (/assign/i.test(qa.control ?? "")) {
    await page
      .waitForFunction(
        `() => {
          const t = document.body.innerText.replace(/\\s+/g, " ");
          return /Assigned approver/i.test(t) && !/Assigned approver None/i.test(t);
        }`,
        undefined,
        { timeout: 8_000 },
      )
      .catch(() => {});
  }
}

async function readSelectOptions(
  select: import("playwright").Locator,
): Promise<{ value: string; label: string }[]> {
  const nodes = select.locator("option");
  const count = await nodes.count();
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const option = nodes.nth(i);
    const label = ((await option.innerText()) ?? "").replace(/\s+/g, " ").trim();
    const value = (await option.getAttribute("value")) ?? "";
    options.push({ value, label });
  }
  return options;
}

async function applySelect(page: import("playwright").Page, step: string): Promise<string | null> {
  const wanted = step.replace(/^select\s+/i, "").replace(/^the\s+/i, "").trim();
  const select = page.locator("select").first();
  await select.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  if ((await select.count()) === 0) {
    return `No select control for: ${step}`;
  }
  const options = await readSelectOptions(select);
  const match = options.find((item) => optionMatches(item.label, wanted));
  if (!match) {
    const listed = options.map((item) => item.label).filter(Boolean).join(", ") || "(none)";
    return `No option matching "${wanted}". Saw: ${listed}.`;
  }
  if (match.value) {
    await select.selectOption({ value: match.value }).catch(() => {});
  } else {
    await select.selectOption({ label: match.label }).catch(() => {});
  }
  await select.evaluate(
    `(el, next) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
      proto && proto.set && proto.set.call(el, next);
      const propsKey = Object.keys(el).find((key) => key.startsWith("__reactProps"));
      const props = propsKey ? el[propsKey] : undefined;
      const native = new Event("change", { bubbles: true });
      try {
        if (props && props.onChange) props.onChange({ target: { value: next } });
      } catch (err) {}
      el.dispatchEvent(native);
    }`,
    match.value || match.label,
  );
  return null;
}

export function optionMatches(optionLabel: string, wanted: string): boolean {
  const option = optionLabel.toLowerCase();
  const want = wanted.toLowerCase().trim();
  if (!want) return false;
  if (option.includes(want)) return true;
  return want.split(/\s+/).every((word) => option.includes(word));
}

async function openTarget(
  page: import("playwright").Page,
  step: string,
  preconditions: string,
): Promise<boolean> {
  await page
    .getByRole("link")
    .filter({ hasText: /INV-/i })
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  const hay = `${step}\n${preconditions}`.toLowerCase();
  const links = page.getByRole("link");
  const count = await links.count();
  const candidates: { index: number; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const name = ((await links.nth(i).innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (/unpaid invoices/i.test(name) && /list/i.test(step)) {
      await links.nth(i).click();
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
      return true;
    }
    if (/^←/.test(name) || /sign out/i.test(name)) continue;
    candidates.push({ index: i, name });
  }

  if (/list/i.test(step) && !/invoice\b/i.test(step.replace(/unpaid invoices list/i, ""))) {
    return true;
  }

  const pick = pickInvoice(candidates, hay);
  if (!pick) return candidates.length === 0;
  const href = (await links.nth(pick.index).getAttribute("href")) ?? "";
  await links.nth(pick.index).click();
  if (href.includes("/invoices/")) {
    await page.waitForURL((url) => String(url).includes(href) || /\/invoices\/[^/]+/.test(new URL(String(url)).pathname), {
      timeout: 15_000,
    });
  } else {
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  }
  return true;
}

export function pickInvoice(
  candidates: { index: number; name: string }[],
  hay: string,
): { index: number; name: string } | undefined {
  const items = candidates.map((item) => ({ ...item, text: item.name.toLowerCase() }));
  const invoices = items.filter((item) => /inv-/.test(item.text));
  // "Operations manager" in preconditions is not "Open the Operations invoice".
  if (/operations invoice|open the operations\b/.test(hay)) {
    return invoices.find((item) => /inv-ops|operations/.test(item.text)) ?? invoices[0];
  }
  if (/unassigned|no assignedapprover|no approver assigned|with no assigned/.test(hay)) {
    const unassigned = invoices.filter((item) => /no approver/.test(item.text));
    if (/finance/.test(hay)) {
      return unassigned.find((item) => /finance|inv-fin/.test(item.text)) ?? unassigned[0] ?? invoices[0];
    }
    return unassigned[0] ?? invoices[0];
  }
  if (/assignedapprover|assigned approver|as assigned/.test(hay)) {
    const assigned = invoices.filter((item) => /approver:/.test(item.text) && !/no approver/.test(item.text));
    if (/finance/.test(hay)) {
      return assigned.find((item) => /finance|inv-fin/.test(item.text)) ?? assigned[0];
    }
    return assigned[0];
  }
  return invoices[0] ?? items.find((item) => /invoice/.test(item.text));
}

async function observe(
  page: import("playwright").Page,
  control: string | null,
): Promise<Pick<CaseObservation, "url" | "text" | "options">> {
  const text = ((await page.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const options = await page.locator("select option").allInnerTexts().catch(() => []);
  return {
    url: page.url(),
    text: `${text}${control ? ` control:${control}` : ""}`.slice(0, 4000),
    options: options.map((item) => item.trim()).filter(Boolean),
  };
}

async function launchChromium(
  playwright: typeof import("playwright"),
  onProgress?: ProgressFn,
): Promise<import("playwright").Browser> {
  const attempts: { label: string; options: { headless: true; timeout: number; channel?: "chrome" | "msedge" } }[] = [];
  const bundled = playwright.chromium.executablePath();
  if (await pathExists(bundled)) {
    attempts.push({ label: "Playwright Chromium", options: { headless: true, timeout: 15_000 } });
  } else {
    onProgress?.(
      "Playwright Chromium is not installed (chrome-headless-shell missing). Trying system Chrome…",
    );
  }
  attempts.push({ label: "system Chrome", options: { headless: true, channel: "chrome", timeout: 15_000 } });
  attempts.push({ label: "system Edge", options: { headless: true, channel: "msedge", timeout: 15_000 } });

  const errors: string[] = [];
  for (const attempt of attempts) {
    onProgress?.(`Launching ${attempt.label}…`);
    await yieldEventLoop();
    try {
      return await playwright.chromium.launch({
        ...attempt.options,
        args: [
          "--disable-save-password-bubble",
          "--disable-features=PasswordManagerOnboarding,PasswordCheck,AutofillServerCommunication",
        ],
      });
    } catch (err) {
      const message = shortError(err);
      onProgress?.(`${attempt.label} failed: ${message}`, "error");
      errors.push(`${attempt.label}: ${message}`);
    }
  }
  throw new Error(
    `Could not launch a browser. ${errors.join(" ")} Install Google Chrome, or from the Req0 repo run "npx playwright install chromium".`,
  );
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n")[0]?.replace(/^browserType\.launch:\s*/i, "").slice(0, 220) ?? "Browser failed.";
}

async function yieldEventLoop(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function emptyObservation(url: string, error: string): CaseObservation {
  return {
    url,
    text: "",
    options: [],
    controlAvailable: false,
    controlDisabled: false,
    clicked: false,
    error,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
