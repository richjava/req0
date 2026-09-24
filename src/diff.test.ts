import { describe, expect, it } from "vitest";
import { unifiedDiff } from "./diff.js";

describe("unifiedDiff", () => {
  it("returns no hunks when the texts match", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("emits a GitHub-style hunk for a one-line change", () => {
    const hunks = unifiedDiff("keep\nold\nkeep\n", "keep\nnew\nkeep\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.header).toBe("@@ -1,3 +1,3 @@");
    expect(hunks[0]?.lines.map((line) => [line.kind, line.text, line.oldNo, line.newNo])).toEqual([
      ["ctx", "keep", 1, 1],
      ["del", "old", 2, null],
      ["add", "new", null, 2],
      ["ctx", "keep", 3, 3],
    ]);
  });

  it("treats a new file as additions from line 0", () => {
    const hunks = unifiedDiff(null, "alpha\nbeta\n");
    expect(hunks[0]?.header).toBe("@@ -0,0 +1,2 @@");
    expect(hunks[0]?.lines.every((line) => line.kind === "add")).toBe(true);
  });

  it("treats a deleted file as removals to line 0", () => {
    const hunks = unifiedDiff("gone\n", null);
    expect(hunks[0]?.header).toBe("@@ -1,1 +0,0 @@");
    expect(hunks[0]?.lines).toEqual([{ kind: "del", text: "gone", oldNo: 1, newNo: null }]);
  });
});
