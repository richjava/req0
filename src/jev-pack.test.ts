import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile.js";
import { emitJevPack } from "./jev-pack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("emitJevPack", () => {
  it("emits the frozen M2 catalog for the golden pack", async () => {
    const markdown = await readFile(
      path.join(repoRoot, "docs/requirements/invoice-approval/requirement.md"),
      "utf8",
    );
    const spec = compileMarkdown("invoice-approval", markdown).spec;
    expect(spec).not.toBeNull();
    const pack = emitJevPack(spec!);
    const ids = pack.questions.map((q) => q.id);
    expect(ids).toContain("rule.observable.BR-001");
    expect(ids).toContain("usecase.contradicts.UC-002");
    expect(ids).toContain("section.score.business-rules");
    expect(ids).toContain("pack.next-id");
    expect(ids).toContain("pack.agent-ready");
    expect(pack.questions.filter((q) => q.type === "noul").length).toBe(11);
    expect(pack.questions.filter((q) => q.type === "score").length).toBe(3);
    expect(pack.questions.filter((q) => q.type === "choice").length).toBe(1);
  });
});
