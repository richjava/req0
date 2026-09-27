import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AMPLIFY_ENV_EXAMPLE,
  AMPLIFY_GEN2_STACK,
  DEFAULT_STACK,
  ENV_EXAMPLE_FILE,
  findRepoRootFromPack,
  hasCustomerApp,
  inspectProductRepo,
  readReq0Config,
  needsStackChoice,
  recordStack,
  resolveStackId,
  stackInstruction,
  UnknownStackError,
  writeReq0Config,
} from "./stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("product repo detection", () => {
  it("treats the Req0 tool package.json as not a customer app", async () => {
    expect(await hasCustomerApp(repoRoot)).toBe(false);
    const repo = await inspectProductRepo(path.join(repoRoot, "docs/requirements/invoice-approval"));
    expect(repo.root).toBe(repoRoot);
    expect(repo.empty).toBe(true);
    expect(repo.recorded).toBe(false);
    expect(repo.implement).toBe(true);
  });

  it("reads implement false from req0.json and keeps it when writing adapter", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-config-"));
    const pack = path.join(dir, "docs/requirements/demo-pack");
    try {
      await writeFile(path.join(dir, "req0.json"), `${JSON.stringify({ implement: false }, null, 2)}\n`, "utf8");
      const repo = await inspectProductRepo(pack);
      expect(repo.root).toBe(dir);
      expect(repo.implement).toBe(false);
      await writeReq0Config(dir, { adapter: "manual" });
      const config = await readReq0Config(dir);
      expect(config?.implement).toBe(false);
      expect(config?.adapter).toBe("manual");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds the repo root from a pack folder", () => {
    expect(findRepoRootFromPack(path.join(repoRoot, "docs/requirements/invoice-approval"))).toBe(repoRoot);
    expect(findRepoRootFromPack("/tmp/not-a-pack")).toBeNull();
  });

  it("keeps an empty repo empty after a stack is recorded", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-stack-empty-"));
    const pack = path.join(dir, "docs/requirements/demo-pack");
    try {
      await writeReq0Config(dir, { stack: AMPLIFY_GEN2_STACK });
      const repo = await inspectProductRepo(pack);
      expect(repo.empty).toBe(true);
      expect(repo.recorded).toBe(true);
      expect(repo.stack.id).toBe("amplify-gen2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not require a stack when there is no product repo root", () => {
    expect(
      needsStackChoice({
        root: null,
        empty: true,
        stack: DEFAULT_STACK,
        recorded: false,
        adapter: "manual",
        implement: true,
      }),
    ).toBe(false);
  });

  it("resolves known stack ids and records one", async () => {
    expect(resolveStackId("amplify-gen2")).toEqual(AMPLIFY_GEN2_STACK);
    expect(resolveStackId("nope")).toBeNull();
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-record-stack-"));
    try {
      await recordStack(dir, "nextjs-default");
      expect((await readReq0Config(dir))?.stack?.id).toBe("nextjs-default");
      await expect(readFile(path.join(dir, ENV_EXAMPLE_FILE), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(recordStack(dir, "nope")).rejects.toBeInstanceOf(UnknownStackError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a names-only Amplify .env.example if missing, and does not overwrite", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-amplify-env-"));
    try {
      await recordStack(dir, "amplify-gen2");
      const written = await readFile(path.join(dir, ENV_EXAMPLE_FILE), "utf8");
      expect(written).toBe(AMPLIFY_ENV_EXAMPLE);
      expect(written).toContain("AWS_REGION=");
      expect(written).toContain("AWS_PROFILE=");
      expect(written).toContain("AWS_ACCESS_KEY_ID=");
      expect(written).toContain("does not read this file");
      expect(written).toContain("configure profile");
      expect(written).not.toContain("AKIA");
      await writeFile(path.join(dir, ENV_EXAMPLE_FILE), "EXISTING=\n", "utf8");
      await recordStack(dir, "amplify-gen2");
      expect(await readFile(path.join(dir, ENV_EXAMPLE_FILE), "utf8")).toBe("EXISTING=\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names the AWS stack option on an empty repo", () => {
    const text = stackInstruction(
      { root: "/tmp/app", empty: true, stack: DEFAULT_STACK, recorded: false, adapter: "manual", implement: true },
      "manual",
    );
    expect(text).toContain("amplify-gen2");
    expect(text).not.toContain("Do not print env values");
  });

  it("uses the recorded stack on an empty repo without asking again", () => {
    const text = stackInstruction(
      {
        root: "/tmp/app",
        empty: true,
        stack: AMPLIFY_GEN2_STACK,
        recorded: true,
        adapter: "cursor",
        implement: true,
      },
      "cursor",
    );
    expect(text).toContain("Recorded stack");
    expect(text).toContain(AMPLIFY_GEN2_STACK.label);
    expect(text).not.toContain("Ask the Requirement Owner");
  });

  it("tells an Amplify repo not to ask for keys", () => {
    const text = stackInstruction(
      {
        root: "/tmp/app",
        empty: false,
        stack: AMPLIFY_GEN2_STACK,
        recorded: true,
        adapter: "cursor",
        implement: true,
      },
      "cursor",
    );
    expect(text).toContain(AMPLIFY_GEN2_STACK.label);
    expect(text).toContain("Do not print env values");
    expect(text).toContain("not the .env file");
    expect(text).toContain("npx ampx configure profile");
    expect(text).not.toContain("already in the product .env");
  });

  it("treats a foreign package.json as a customer app", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-app-"));
    try {
      await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "invoice-app" }, null, 2)}\n`);
      expect(await hasCustomerApp(dir)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
