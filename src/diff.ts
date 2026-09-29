export type DiffLineKind = "ctx" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};

type Edit = { type: "eq" | "del" | "add"; line: string };

export function splitLines(text: string | null): string[] {
  if (text == null || text === "") return [];
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

export function unifiedDiff(oldText: string | null, newText: string | null, context = 3): DiffHunk[] {
  if (oldText === newText) return [];
  return collapseHunks(lcsEdits(splitLines(oldText), splitLines(newText)), context);
}

function lcsEdits(before: string[], after: string[]): Edit[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i];
    const next = dp[i + 1];
    if (!row) continue;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        before[i] === after[j]
          ? (next?.[j + 1] ?? 0) + 1
          : Math.max(next?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      edits.push({ type: "eq", line: before[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      edits.push({ type: "del", line: before[i] ?? "" });
      i += 1;
    } else {
      edits.push({ type: "add", line: after[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    edits.push({ type: "del", line: before[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    edits.push({ type: "add", line: after[j] ?? "" });
    j += 1;
  }
  return edits;
}

function collapseHunks(edits: Edit[], context: number): DiffHunk[] {
  type Marked = Edit & { oldNo: number | null; newNo: number | null; change: boolean };
  let oldNo = 1;
  let newNo = 1;
  const marked: Marked[] = edits.map((edit) => {
    if (edit.type === "eq") {
      const row = { ...edit, oldNo, newNo, change: false };
      oldNo += 1;
      newNo += 1;
      return row;
    }
    if (edit.type === "del") {
      const row = { ...edit, oldNo, newNo: null as number | null, change: true };
      oldNo += 1;
      return row;
    }
    const row = { ...edit, oldNo: null as number | null, newNo, change: true };
    newNo += 1;
    return row;
  });

  const changeIdx = marked.flatMap((edit, index) => (edit.change ? [index] : []));
  if (changeIdx.length === 0) return [];

  const ranges: { start: number; end: number }[] = [];
  let start = Math.max(0, (changeIdx[0] ?? 0) - context);
  let end = Math.min(marked.length, (changeIdx[0] ?? 0) + 1 + context);
  for (const index of changeIdx.slice(1)) {
    const nextStart = Math.max(0, index - context);
    const nextEnd = Math.min(marked.length, index + 1 + context);
    if (nextStart <= end) {
      end = nextEnd;
    } else {
      ranges.push({ start, end });
      start = nextStart;
      end = nextEnd;
    }
  }
  ranges.push({ start, end });

  return ranges.map((range) => {
    const slice = marked.slice(range.start, range.end);
    const oldLines = slice.filter((edit) => edit.oldNo != null);
    const newLines = slice.filter((edit) => edit.newNo != null);
    const oldStart = oldLines[0]?.oldNo ?? 0;
    const newStart = newLines[0]?.newNo ?? 0;
    return {
      header: `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
      oldStart,
      newStart,
      lines: slice.map((edit) => ({
        kind: edit.type === "eq" ? "ctx" : edit.type === "del" ? "del" : "add",
        text: edit.line,
        oldNo: edit.oldNo,
        newNo: edit.newNo,
      })),
    };
  });
}
