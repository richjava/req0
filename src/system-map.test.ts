import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONVENTION_SYSTEM_REL, loadSystemMap } from "./system-map.js";

describe("loadSystemMap", () => {
  it("treats a missing file as empty, not an error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-sys-missing-"));
    try {
      const loaded = await loadSystemMap(dir, null);
      expect(loaded.exists).toBe(false);
      expect(loaded.text).toBe("");
      expect(loaded.path).toBe(CONVENTION_SYSTEM_REL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads the convention file when it exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-sys-conv-"));
    try {
      await mkdir(path.join(dir, "docs"), { recursive: true });
      await writeFile(path.join(dir, CONVENTION_SYSTEM_REL), "# System\n\n## Entities\n\nInvoice\n", "utf8");
      const loaded = await loadSystemMap(dir, null);
      expect(loaded.exists).toBe(true);
      expect(loaded.path).toBe(CONVENTION_SYSTEM_REL);
      expect(loaded.text).toContain("Invoice");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prefers req0.json system path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-sys-cfg-"));
    try {
      await mkdir(path.join(dir, "model"), { recursive: true });
      await writeFile(path.join(dir, "model/schema.md"), "# Custom map\n", "utf8");
      const loaded = await loadSystemMap(dir, { system: "model/schema.md" });
      expect(loaded.exists).toBe(true);
      expect(loaded.path).toBe("model/schema.md");
      expect(loaded.text).toContain("Custom map");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
