import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasJevAccess, JevRequestError, JevUnavailableError } from "./jev.js";
import { implementPack, finishImplement, ignoreBuild, launchImprove, stopImplement, StopImplementLockedError, writeImproveBrief, checkPack, compilePack, createPack, findRequirementsDir, listPacks, provePack, writeRequirement } from "./pack.js";
import { IgnoreBuildLockedError } from "./ready.js";
import { ImproveLockedError } from "./improve.js";
import {
  acceptImproveReview,
  applyImproveReviewGate,
  evaluateImproveReview,
  ImproveLintError,
  ImproveReviewPendingError,
  rejectImproveReview,
} from "./improve-review.js";
import type { LaunchAdapterResult } from "./implement.js";
import { inspectProductRepo, recordStack, UnknownStackError } from "./stack.js";
import { pipelineView, sectionCatalog } from "./stages.js";
import type { PackPaths } from "./pack.js";
import type { ActivityLevel, ActivityLine, CompileResult } from "./types.js";

const cockpitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cockpit");

export type AppState = {
  cwd: string;
  pack: PackPaths | null;
  last: CompileResult | null;
  activity: ActivityLine[];
  busy: "prove" | "improve" | "implement" | null;
  implementLaunch: LaunchAdapterResult | null;
};

export function createAppState(cwd: string, pack: PackPaths | null): AppState {
  return { cwd, pack, last: null, activity: [], busy: null, implementLaunch: null };
}

export async function refresh(state: AppState): Promise<CompileResult | null> {
  if (!state.pack) {
    state.last = null;
    return null;
  }
  state.last = await compilePack(state.pack);
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
    if (url.pathname === "/api/events") {
      // Retired. A hanging EventSource pins Chrome/Electron refresh forever.
      // Finish immediately so leftover clients cannot stall a reload.
      const body = "Gone. The cockpit polls GET /api/state.\n";
      res.writeHead(410, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "close",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
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
      try {
        state.last = await writeRequirement(state.pack, markdown);
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not save.",
          },
          err instanceof ImproveReviewPendingError ? 409 : 500,
        );
        return;
      }
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
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/improve") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (state.busy) {
        await sendJson(res, {
          ...(await snapshot(state)),
          started: true,
          message: state.busy === "improve" ? "Improve is already running." : "Another action is already running.",
        });
        return;
      }
      const body = await readJson(req);
      const adapter = body["adapter"] === "manual" ? "manual" : "cursor";
      try {
        const written = await writeImproveBrief(state.pack, state.last);
        state.last = written.result;
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Improve failed.",
          },
          err instanceof ImproveLockedError || err instanceof ImproveReviewPendingError ? 409 : 500,
        );
        return;
      }
      const pack = state.pack;
      state.busy = "improve";
      state.activity = [];
      pushActivity(state, "Wrote derived/improve-brief.md.");
      if (adapter === "manual") {
        pushActivity(state, "Manual adapter: open the brief in any coding agent.", "ok");
        state.busy = null;
        await sendJson(res, {
          ...(await snapshot(state)),
          started: false,
          message: "Wrote derived/improve-brief.md. Open it in any coding agent.",
        });
        return;
      }
      pushActivity(state, "Launching Cursor to patch requirement.md…");
      await yieldEventLoop();
      await sendJson(res, {
        ...(await snapshot(state)),
        started: true,
        message: "Wrote the brief. Launching Cursor…",
      });
      void runImprove(state, pack, adapter);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/improve/accept") {
      await decideImproveReview(state, res, "accept");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/improve/reject") {
      await decideImproveReview(state, res, "reject");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/stack") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      const repo = await inspectProductRepo(state.pack.root);
      if (!repo.root) {
        sendJson(res, { error: "No product repo root, so the stack cannot be recorded." }, 400);
        return;
      }
      const body = await readJson(req);
      try {
        await recordStack(repo.root, String(body["id"] ?? ""));
        await refresh(state);
        await sendJson(res, await snapshot(state));
      } catch (err) {
        sendJson(
          res,
          { error: err instanceof Error ? err.message : "Could not record stack." },
          err instanceof UnknownStackError ? 400 : 409,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/implement") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (state.busy === "implement") {
        await sendJson(res, { ...(await snapshot(state)), started: true, message: "Implement is already running." });
        return;
      }
      const body = await readJson(req);
      const adapter = body["adapter"] === "manual" ? "manual" : "cursor";
      const stack = typeof body["stack"] === "string" && body["stack"].trim() ? String(body["stack"]) : undefined;
      const fromProof = body["fromProof"] === true;
      try {
        state.activity = [];
        pushActivity(state, fromProof ? "Fix from proof started." : "Implement started.");
        const launched = await implementPack(state.pack, {
          ...(stack ? { adapter, stack } : { adapter }),
          ...(fromProof ? { fromProof: true } : {}),
          onLogLine: (line) => pushActivity(state, line),
        });
        state.last = launched.result;
        if (launched.launch?.finished) {
          state.busy = "implement";
          state.implementLaunch = launched.launch;
          pushActivity(state, launched.message);
          await yieldEventLoop();
          await sendJson(res, {
            ...(await snapshot(state)),
            started: true,
            message: launched.message,
          });
          void runImplement(state, state.pack, launched.launch, adapter);
          return;
        }
        pushActivity(state, launched.message, launched.result.health.build.state === "failed" ? "error" : "ok");
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

    if (req.method === "POST" && url.pathname === "/api/stop-implement") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (!state.implementLaunch || state.busy !== "implement") {
        sendJson(res, { ...(await snapshot(state)), error: "Implement is not running." }, 409);
        return;
      }
      try {
        const stopped = await stopImplement(state.pack, state.implementLaunch);
        state.last = stopped.result;
        pushActivity(state, stopped.message, "ok");
        await sendJson(res, { ...(await snapshot(state)), message: stopped.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Stop failed.",
          },
          err instanceof StopImplementLockedError ? 409 : 500,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ignore-build") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      const body = await readJson(req);
      if (typeof body["successful"] !== "boolean") {
        sendJson(res, { error: "successful must be true or false." }, 400);
        return;
      }
      try {
        const ignored = await ignoreBuild(state.pack, body["successful"]);
        state.last = ignored.result;
        pushActivity(state, ignored.message, "ok");
        await sendJson(res, { ...(await snapshot(state)), message: ignored.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Ignore failed.",
          },
          err instanceof IgnoreBuildLockedError ? 409 : 500,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prove") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (state.busy === "prove") {
        await sendJson(res, { ...(await snapshot(state)), started: true, message: "Prove is already running." });
        return;
      }
      const pack = state.pack;
      state.busy = "prove";
      state.activity = [];
      pushActivity(state, "Prove started.");
      await yieldEventLoop();
      await sendJson(res, { ...(await snapshot(state)), started: true, message: "Prove started." });
      void runProve(state, pack);
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
  const improveReview = state.pack ? await evaluateImproveReview(state.pack) : null;
  if (improveReview?.files.length && !state.activity.some((line) => line.message === "Improve patch ready to review.")) {
    pushActivity(state, "Improve patch ready to review.", "ok");
  }
  const health = state.last ? applyImproveReviewGate(state.last.health, improveReview) : null;
  let proofReport = "";
  if (state.pack) {
    try {
      proofReport = await readFile(state.pack.proofReport, "utf8");
    } catch {
      proofReport = "";
    }
  }
  return {
    cwd: state.cwd,
    packId: state.pack?.id ?? null,
    packRoot: state.pack?.root ?? null,
    packs: packs.map((p) => p.id),
    markdown: state.last?.markdown ?? "",
    health,
    spec: state.last?.spec ?? null,
    pipeline: pipelineView(health, Boolean(state.pack)),
    sections: sectionCatalog(),
    proofReport,
    hasApiKey: hasJevAccess(),
    productRepo: state.pack ? await inspectProductRepo(state.pack.root) : null,
    activity: state.activity,
    busy: state.busy,
    improveReview,
  };
}

async function decideImproveReview(state: AppState, res: ServerResponse, decision: "accept" | "reject"): Promise<void> {
  if (!state.pack) {
    sendJson(res, { error: "No pack selected." }, 400);
    return;
  }
  try {
    if (decision === "accept") await acceptImproveReview(state.pack);
    else await rejectImproveReview(state.pack);
  } catch (err) {
    sendJson(
      res,
      {
        ...(await snapshot(state)),
        error: err instanceof Error ? err.message : "Improve review failed.",
      },
      err instanceof ImproveReviewPendingError || err instanceof ImproveLintError ? 409 : 500,
    );
    return;
  }
  state.last = await compilePack(state.pack);
  pushActivity(
    state,
    decision === "accept" ? "Accepted the Improve patch." : "Rejected the Improve patch.",
    "ok",
  );
  await sendJson(res, {
    ...(await snapshot(state)),
    message: decision === "accept" ? "Kept the patch. Check when you are ready." : "Restored the spec from before Improve.",
  });
}

async function runImprove(state: AppState, pack: PackPaths, adapter: "cursor" | "manual"): Promise<void> {
  try {
    const launched = await launchImprove(pack, { adapter });
    pushActivity(state, launched.message, launched.ok ? "ok" : "error");
  } catch (err) {
    pushActivity(state, err instanceof Error ? err.message : "Improve failed.", "error");
  } finally {
    state.busy = null;
  }
}

async function runImplement(
  state: AppState,
  pack: PackPaths,
  launch: LaunchAdapterResult,
  adapter: "cursor" | "manual",
): Promise<void> {
  try {
    const done = await finishImplement(pack, launch, adapter);
    if (state.pack?.root === pack.root) state.last = done.result;
    pushActivity(state, done.message, done.result.health.build.state === "failed" ? "error" : "ok");
  } catch (err) {
    pushActivity(state, err instanceof Error ? err.message : "Implement failed.", "error");
  } finally {
    if (state.busy === "implement") state.busy = null;
    if (state.implementLaunch === launch) state.implementLaunch = null;
  }
}

async function runProve(state: AppState, pack: PackPaths): Promise<void> {
  try {
    const proved = await provePack(pack, {
      onProgress: (message, level) => pushActivity(state, message, level),
    });
    state.last = proved.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prove failed.";
    pushActivity(state, message, "error");
    if (err instanceof JevUnavailableError && state.pack) {
      state.last = await compilePack(state.pack);
    }
  } finally {
    state.busy = null;
  }
}

function pushActivity(state: AppState, message: string, level: ActivityLevel = "info"): void {
  const line: ActivityLine = { at: new Date().toISOString(), level, message };
  state.activity = [...state.activity, line].slice(-80);
}

async function yieldEventLoop(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function serveCockpit(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relative.includes("..")) return false;
  const file = path.join(cockpitDir, relative);
  if (!file.startsWith(cockpitDir)) return false;
  try {
    if (relative === "index.html") {
      const html = await cacheBustHtml(await readFile(file, "utf8"));
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return true;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": contentType(file),
      "Cache-Control": "no-store",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function cacheBustHtml(html: string): Promise<string> {
  let out = html;
  for (const asset of ["tokens.css", "styles.css", "app.js", "markdown-editor.js"] as const) {
    const { mtimeMs } = await stat(path.join(cockpitDir, asset));
    out = out.replaceAll(`/${asset}"`, `/${asset}?v=${Math.floor(mtimeMs)}"`);
  }
  return out;
}

function contentType(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
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
