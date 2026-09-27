import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPack, packPaths } from "./pack.js";
import { createAppState, createCockpitServer } from "./server.js";
import { readReq0Config } from "./stack.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cockpitDir = path.join(root, "cockpit");

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    closing.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("cockpit reload contract", () => {
  it("does not open EventSource or load blocking third-party fonts", async () => {
    const js = await readFile(path.join(cockpitDir, "app.js"), "utf8");
    const html = await readFile(path.join(cockpitDir, "index.html"), "utf8");
    expect(js).not.toMatch(/\bnew\s+EventSource\b|EventSource\s*\(/);
    expect(html).not.toMatch(/\bnew\s+EventSource\b|EventSource\s*\(/);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(js).toMatch(/\/api\/state/);
    expect(js).toMatch(/from\s+["']\.\/markdown-editor\.js["']/);
    const bundle = await readFile(path.join(cockpitDir, "markdown-editor.js"), "utf8");
    expect(bundle).toMatch(/createMarkdownEditor/);
    expect(bundle).toMatch(/@codemirror|EditorView|markdown/);
  });

  it("finishes /api/events immediately so leftover EventSource cannot pin refresh", async () => {
    const { url } = await listen();
    const started = Date.now();
    const res = await fetch(`${url}/api/events`);
    const elapsed = Date.now() - started;
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).not.toMatch(/event-stream/);
    expect(elapsed).toBeLessThan(500);
    await expect(res.text()).resolves.toMatch(/polls GET \/api\/state/);
  });

  it("finishes / and /api/state so a reload can complete", async () => {
    const { url } = await listen();
    const started = Date.now();
    const [page, state] = await Promise.all([fetch(`${url}/`), fetch(`${url}/api/state`)]);
    const elapsed = Date.now() - started;
    expect(page.status).toBe(200);
    expect(state.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
    const html = await page.text();
    expect(html).toMatch(/app\.js\?v=\d+/);
    expect(html).toMatch(/no-store/);
    expect(html).toContain("req0-logo-horiz.png");
    expect(html).toContain("pipeline-graph");
    const logo = await fetch(`${url}/req0-logo-horiz.png`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toMatch(/image\/png/);
    expect(html).toContain("stage-nav");
    expect(html).toContain("view-define");
    expect(html).toContain("view-spec");
    expect(html).toContain("status-bar");
    expect(html).toContain("view-judgment");
    expect(html).toContain("view-implement");
    expect(html).toContain("view-qa");
    expect(html).toContain("action-build-ignore");
    expect(html).toContain("action-build-stop");
    expect(html).toContain("markdown-editor");
    expect(html).toContain("Was implementation successful?");
    expect(html).not.toContain("meter-spec");
    expect(html).not.toMatch(/\bnew\s+EventSource\b|EventSource\s*\(/);
    const editor = await fetch(`${url}/markdown-editor.js`);
    expect(editor.status).toBe(200);
    expect(await editor.text()).toMatch(/createMarkdownEditor/);
    const snap = await state.json();
    expect(snap).toMatchObject({ busy: null });
    expect(snap.pipeline.nodes.map((node) => node.id)).toEqual(["start", "define", "implement", "qa", "end"]);
    expect(snap.sections[0]).toMatchObject({ name: "Business Rules", required: true });
  });

  it("records a stack on POST /api/stack", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "req0-api-stack-"));
    const pack = packPaths(path.join(parent, "docs/requirements/demo-pack"));
    try {
      await createPack(pack.root);
      const { url } = await listen(createAppState(parent, pack));
      const before = await (await fetch(`${url}/api/state`)).json();
      expect(before.productRepo.empty).toBe(true);
      expect(before.productRepo.recorded).toBe(false);
      const html = await (await fetch(`${url}/`)).text();
      expect(html).toContain("stack-gate");
      expect(html).toContain("stack-bar");
      const res = await fetch(`${url}/api/stack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "amplify-gen2" }),
      });
      expect(res.status).toBe(200);
      const after = await res.json();
      expect(after.productRepo.recorded).toBe(true);
      expect(after.productRepo.stack.id).toBe("amplify-gen2");
      expect(after.productRepo.empty).toBe(true);
      expect((await readReq0Config(parent))?.stack?.id).toBe("amplify-gen2");
      expect(await readFile(path.join(parent, ".env.example"), "utf8")).toContain("AWS_REGION=");
      expect(await readFile(path.join(parent, ".env.example"), "utf8")).not.toContain("AKIA");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

async function listen(appState = createAppState(root, null)): Promise<{ url: string }> {
  const state = appState;
  server = createCockpitServer(state);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("cockpit test server has no port");
  return { url: `http://127.0.0.1:${addr.port}` };
}
