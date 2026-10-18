import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Req0Config } from "./types.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const STANDARDS_CONVENTION_DIR = "docs/requirement-standards";
export const STANDARDS_PACK_FILE = "pack.md";
export const STANDARDS_DOCUMENT_FILE = "document.md";

export const CONVENTION_PACK_REL = path.join(STANDARDS_CONVENTION_DIR, STANDARDS_PACK_FILE);
export const CONVENTION_DOCUMENT_REL = path.join(STANDARDS_CONVENTION_DIR, STANDARDS_DOCUMENT_FILE);

export const PACKAGE_PACK_STANDARD = path.join(PACKAGE_ROOT, CONVENTION_PACK_REL);
export const PACKAGE_DOCUMENT_STANDARD = path.join(PACKAGE_ROOT, CONVENTION_DOCUMENT_REL);

export type StandardsSource = "config" | "convention" | "package";

export type ResolvedStandardFile = {
  path: string;
  source: StandardsSource;
  text: string;
};

export type LoadedStandards = {
  pack: ResolvedStandardFile;
  document: ResolvedStandardFile;
};

async function fileText(filePath: string): Promise<string | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function configuredPath(repoRoot: string, raw: string | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

function displayPath(repoRoot: string | null, abs: string): string {
  if (!repoRoot) return abs;
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(abs);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved === root || resolved.startsWith(prefix)) {
    return path.relative(root, resolved).split(path.sep).join("/") || ".";
  }
  return abs;
}

async function resolveOne(
  repoRoot: string | null,
  configured: string | undefined,
  conventionRel: string,
  packaged: string,
): Promise<ResolvedStandardFile> {
  if (repoRoot) {
    const fromConfig = configuredPath(repoRoot, configured);
    if (fromConfig) {
      const text = await fileText(fromConfig);
      if (text) return { path: displayPath(repoRoot, fromConfig), source: "config", text };
    }
    const convention = path.join(repoRoot, conventionRel);
    if (await exists(convention)) {
      const text = await fileText(convention);
      if (text) return { path: displayPath(repoRoot, convention), source: "convention", text };
    }
  }
  const packagedText = (await fileText(packaged)) ?? "";
  return { path: displayPath(repoRoot, packaged), source: "package", text: packagedText };
}

export async function loadStandards(
  repoRoot: string | null,
  config?: Req0Config | null,
): Promise<LoadedStandards> {
  const [pack, document] = await Promise.all([
    resolveOne(repoRoot, config?.standards?.pack, CONVENTION_PACK_REL, PACKAGE_PACK_STANDARD),
    resolveOne(repoRoot, config?.standards?.document, CONVENTION_DOCUMENT_REL, PACKAGE_DOCUMENT_STANDARD),
  ]);
  return { pack, document };
}

export function standardsBriefSection(standards: LoadedStandards | null | undefined): string[] {
  if (!standards) return [];
  return [
    "## House standards",
    "",
    "Read both files. Satisfy them in **substance**. Emit **frozen grammar** (the required and optional `##` headings, `BR-NNN` / `UC-NNN`, and matrix `allow`/`deny`). Do not copy these files into the pack. Do not emit headings the compiler rejects.",
    "If a house rule conflicts with the owner, write `derived/agent-questions.json` and stop. Do not guess.",
    "",
    `- Pack standard: \`${standards.pack.path}\``,
    `- Document standard: \`${standards.document.path}\``,
    "",
    "Artifacts live in this pack's `context/` folder. Prefer `{UC-id}__{purpose}.ext` (example: `UC-001__replace-modal.png`) and mention them from the matching use case. Screenshots illustrate; they must not be the only place a behaviour is specified.",
    "",
  ];
}
