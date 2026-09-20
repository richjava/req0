import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRepoRootFromPack, hasCustomerApp, inspectProductRepo } from "./stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("product repo detection", () => {
  it("treats the Req0 tool package.json as not a customer app", async () => {
    expect(await hasCustomerApp(repoRoot)).toBe(false);
    const repo = await inspectProductRepo(path.join(repoRoot, "docs/requirements/invoice-approval"));
    expect(repo.root).toBe(repoRoot);
    expect(repo.empty).toBe(true);
    expect(repo.recorded).toBe(false);
  });

  it("finds the repo root from a pack folder", () => {
    expect(findRepoRootFromPack(path.join(repoRoot, "docs/requirements/invoice-approval"))).toBe(repoRoot);
    expect(findRepoRootFromPack("/tmp/not-a-pack")).toBeNull();
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
