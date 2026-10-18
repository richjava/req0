import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONVENTION_DOCUMENT_REL,
  CONVENTION_PACK_REL,
  PACKAGE_DOCUMENT_STANDARD,
  PACKAGE_PACK_STANDARD,
  loadStandards,
} from "./standards.js";

describe("loadStandards", () => {
  it("falls back to the packaged copies when the product repo has no house files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-std-pkg-"));
    try {
      const loaded = await loadStandards(dir, null);
      expect(loaded.pack.source).toBe("package");
      expect(loaded.document.source).toBe("package");
      expect(loaded.pack.path).toBe(PACKAGE_PACK_STANDARD);
      expect(loaded.document.path).toBe(PACKAGE_DOCUMENT_STANDARD);
      expect(loaded.pack.text).toContain("docs/requirements/<kebab-id>/");
      expect(loaded.document.text).toContain("BR-001");
      expect(loaded.document.text).toContain("Do not emit `REQ_016_…`");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses convention paths when those files exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-std-conv-"));
    try {
      await mkdir(path.join(dir, "docs/requirement-standards"), { recursive: true });
      await writeFile(path.join(dir, CONVENTION_PACK_REL), "# House pack\n", "utf8");
      await writeFile(path.join(dir, CONVENTION_DOCUMENT_REL), "# House document\n", "utf8");
      const loaded = await loadStandards(dir, null);
      expect(loaded.pack.source).toBe("convention");
      expect(loaded.document.source).toBe("convention");
      expect(loaded.pack.path).toBe(CONVENTION_PACK_REL);
      expect(loaded.document.path).toBe(CONVENTION_DOCUMENT_REL);
      expect(loaded.pack.text).toContain("House pack");
      expect(loaded.document.text).toContain("House document");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prefers req0.json paths and falls back when they are missing or empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-std-cfg-"));
    try {
      await mkdir(path.join(dir, "house"), { recursive: true });
      await writeFile(path.join(dir, "house/pack.md"), "# Config pack\n", "utf8");
      await writeFile(path.join(dir, "house/document.md"), "# Config document\n", "utf8");
      const loaded = await loadStandards(dir, {
        standards: { pack: "house/pack.md", document: "house/document.md" },
      });
      expect(loaded.pack.source).toBe("config");
      expect(loaded.document.source).toBe("config");
      expect(loaded.pack.path).toBe("house/pack.md");
      expect(loaded.pack.text).toContain("Config pack");

      const missing = await loadStandards(dir, {
        standards: { pack: "missing/pack.md", document: "missing/document.md" },
      });
      expect(missing.pack.source).toBe("package");
      expect(missing.document.source).toBe("package");

      await writeFile(path.join(dir, "house/empty.md"), "   \n", "utf8");
      const empty = await loadStandards(dir, { standards: { pack: "house/empty.md" } });
      expect(empty.pack.source).toBe("package");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
