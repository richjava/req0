import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAppState, createCockpitServer } from "./server.js";

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
    await expect(state.json()).resolves.toMatchObject({ busy: null });
  });
});

async function listen(): Promise<{ url: string }> {
  const state = createAppState(root, null);
  server = createCockpitServer(state);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("cockpit test server has no port");
  return { url: `http://127.0.0.1:${addr.port}` };
}
