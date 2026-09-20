import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasJevAccess, JevRequestError, JevUnavailableError } from "./jev.js";
import { implementPack, checkPack, compilePack, createPack, findRequirementsDir, listPacks, writeRequirement } from "./pack.js";
import { inspectProductRepo } from "./stack.js";
import type { PackPaths } from "./pack.js";
import type { CompileResult } from "./types.js";

const cockpitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cockpit");

type SseClient = ServerResponse;

export type AppState = {
  cwd: string;
  pack: PackPaths | null;
  last: CompileResult | null;
  clients: Set<SseClient>;
};

export function createAppState(cwd: string, pack: PackPaths | null): AppState {
  return { cwd, pack, last: null, clients: new Set() };
}

export async function refresh(state: AppState): Promise<CompileResult | null> {
  if (!state.pack) {
    state.last = null;
    return null;
  }
  state.last = await compilePack(state.pack);
  broadcast(state);
  return state.last;
}

export function createCockpitServer(state: AppState) {
  return createServer((req, res) => {
    void handle(state, req, res);
  });
}

async function handle(state: AppState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":\n\n");
      state.clients.add(res);
      req.on("close", () => state.clients.delete(res));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/select") {
      const body = await readJson(req);
      const id = String(body["id"] ?? "");
      const requirementsDir = await findRequirementsDir(state.cwd);
      if (!requirementsDir) {
        sendJson(res, { error: "No docs/requirements directory found." }, 400);
        return;
      }
      const packs = await listPacks(requirementsDir);
      const chosen = packs.find((p) => p.id === id);
      if (!chosen) {
        sendJson(res, { error: `Unknown pack "${id}".` }, 404);
        return;
      }
      state.pack = chosen;
      await refresh(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/create") {
      const body = await readJson(req);
      const id = String(body["id"] ?? "").trim();
      const requirementsDir =
        (await findRequirementsDir(state.cwd)) ?? path.join(state.cwd, "docs", "requirements");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        sendJson(res, { error: "Id must be kebab-case [a-z0-9-]+." }, 400);
        return;
      }
      state.pack = await createPack(path.join(requirementsDir, id));
      await refresh(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/requirement") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      const body = await readJson(req);
      const markdown = String(body["markdown"] ?? "");
      state.last = await writeRequirement(state.pack, markdown);
      broadcast(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/check-jev") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      try {
        state.last = await checkPack(state.pack);
      } catch (err) {
        if (err instanceof JevUnavailableError) {
          state.last = await compilePack(state.pack);
          await sendJson(res, { ...(await snapshot(state)), error: err.message }, 409);
          return;
        }
        if (err instanceof JevRequestError) {
          sendJson(res, { ...(await snapshot(state)), error: err.message }, 502);
          return;
        }
        throw err;
      }
      broadcast(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/implement") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      const body = await readJson(req);
      const adapter = body["adapter"] === "manual" ? "manual" : "cursor";
      try {
        const launched = await implementPack(state.pack, { adapter });
        state.last = launched.result;
        broadcast(state);
        await sendJson(res, { ...(await snapshot(state)), message: launched.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Implement failed.",
          },
          409,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/create-in-place") {
      if (!state.pack) {
        sendJson(res, { error: "No pack folder selected." }, 400);
        return;
      }
      state.pack = await createPack(state.pack.root);
      await refresh(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/"))) {
      const served = await serveCockpit(url.pathname, res);
      if (!served) {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }));
  }
}

async function snapshot(state: AppState) {
  const requirementsDir = await findRequirementsDir(state.cwd);
  const packs = requirementsDir ? await listPacks(requirementsDir) : [];
  if (state.pack && !state.last) {
    state.last = await compilePack(state.pack);
  }
  return {
    cwd: state.cwd,
    packId: state.pack?.id ?? null,
    packRoot: state.pack?.root ?? null,
    packs: packs.map((p) => p.id),
    markdown: state.last?.markdown ?? "",
    health: state.last?.health ?? null,
    spec: state.last?.spec ?? null,
    hasApiKey: hasJevAccess(),
    productRepo: state.pack ? await inspectProductRepo(state.pack.root) : null,
  };
}

function broadcast(state: AppState): void {
  const payload = `data: reload\n\n`;
  for (const client of state.clients) {
    client.write(payload);
  }
}

async function serveCockpit(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relative.includes("..")) return false;
  const file = path.join(cockpitDir, relative);
  if (!file.startsWith(cockpitDir)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": contentType(file) });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function contentType(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}
