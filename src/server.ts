import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasJevAccess, JevRequestError, JevUnavailableError } from "./jev.js";
import { implementPack, finishImplement, ignoreBuild, launchImprove, stopImplement, StopImplementLockedError, writeImproveBrief, checkPack, compilePack, createPack, deletePack, findRequirementsDir, listPacks, provePack, summarizePacks, writeRequirement, answerAgentQuestions, discardAgentQuestions, startAuthor, settleAuthor, launchAuthor, stopAuthor, saveAuthorArtifact, readAuthorRun } from "./pack.js";
import { IgnoreBuildLockedError } from "./ready.js";
import { ImproveLockedError } from "./improve.js";
import { applyAuthorGate, AuthorArtifactError, AuthorLockedError } from "./author.js";
import {
  acceptImproveReview,
  applyImproveReviewGate,
  evaluateImproveReview,
  ImproveLintError,
  ImproveReviewPendingError,
  rejectImproveReview,
} from "./improve-review.js";
import type { LaunchAdapterResult } from "./implement.js";
import { inspectProductRepo, needsStackChoice, recordProjectSetup, recordStack, UnknownStackError } from "./stack.js";
import { adapterDisplayName, parseAdapterId } from "./adapter.js";
import { pipelineView, sectionCatalog } from "./stages.js";
import type { PackPaths } from "./pack.js";
import type { ActivityChannel, ActivityLevel, ActivityLine, AdapterId, CompileResult } from "./types.js";
import {
  AGENT_QUESTIONS_WAITING,
  AgentAnswersError,
  applyAgentQuestionsGate,
  isOpenQuestions,
  readAgentQuestions,
} from "./agent-questions.js";

const cockpitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cockpit");

export type AppState = {
  cwd: string;
  pack: PackPaths | null;
  last: CompileResult | null;
  implementActivity: ActivityLine[];
  proveActivity: ActivityLine[];
  authorActivity: ActivityLine[];
  busy: "prove" | "improve" | "implement" | "author" | null;
  implementLaunch: LaunchAdapterResult | null;
  authorLaunch: LaunchAdapterResult | null;
};

export function createAppState(cwd: string, pack: PackPaths | null): AppState {
  return {
    cwd,
    pack,
    last: null,
    implementActivity: [],
    proveActivity: [],
    authorActivity: [],
    busy: null,
    implementLaunch: null,
    authorLaunch: null,
  };
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
      clearActivity(state);
      await refresh(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/home") {
      state.pack = null;
      state.last = null;
      clearActivity(state);
      await sendJson(res, await snapshot(state));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/delete") {
      const body = await readJson(req);
      const id = String(body["id"] ?? "").trim();
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
      if (state.busy && state.pack?.root === chosen.root) {
        sendJson(res, { error: "Stop the current run before deleting this requirement." }, 409);
        return;
      }
      if (state.pack?.root === chosen.root) {
        state.pack = null;
        state.last = null;
        clearActivity(state);
      }
      await deletePack(chosen);
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
      const adapter = parseAdapterId(body["adapter"]) ?? "cursor";
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
      clearActivity(state, "implement");
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
      pushActivity(state, `Launching ${adapterDisplayName(adapter)} to patch requirement.md…`);
      await yieldEventLoop();
      await sendJson(res, {
        ...(await snapshot(state)),
        started: true,
        message: `Wrote the brief. Launching ${adapterDisplayName(adapter)}…`,
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
      const repo = await inspectProductRepo(await inspectFrom(state));
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

    if (req.method === "POST" && url.pathname === "/api/setup") {
      const repo = await inspectProductRepo(await inspectFrom(state));
      if (!repo.root) {
        sendJson(res, { error: "No product repo root, so setup cannot be recorded." }, 400);
        return;
      }
      const body = await readJson(req);
      const coding = body["coding"];
      if (coding !== "manual" && coding !== "cursor" && coding !== "copilot") {
        sendJson(res, { error: "Choose I'll write the code, Cursor, or Copilot." }, 400);
        return;
      }
      const stackId = typeof body["stack"] === "string" && body["stack"].trim() ? String(body["stack"]) : undefined;
      if (coding !== "manual" && !stackId && needsStackChoice({ ...repo, implement: true })) {
        sendJson(res, { error: "Choose a stack for Cursor or Copilot on an empty repo." }, 400);
        return;
      }
      try {
        await recordProjectSetup(repo.root, stackId ? { coding, stack: stackId } : { coding });
        await refresh(state);
        await sendJson(res, await snapshot(state));
      } catch (err) {
        sendJson(
          res,
          { error: err instanceof Error ? err.message : "Could not record setup." },
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
      const adapter = parseAdapterId(body["adapter"]) ?? "cursor";
      const stack = typeof body["stack"] === "string" && body["stack"].trim() ? String(body["stack"]) : undefined;
      const fromProof = body["fromProof"] === true;
      try {
        clearActivity(state, "implement");
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
      const waiting = isOpenQuestions(await readAgentQuestions(state.pack));
      if ((!state.implementLaunch || state.busy !== "implement") && !waiting) {
        sendJson(res, { ...(await snapshot(state)), error: "Implement is not running." }, 409);
        return;
      }
      try {
        const stopped = waiting && (!state.implementLaunch || state.busy !== "implement")
          ? await discardAgentQuestions(state.pack, state.implementLaunch)
          : await stopImplement(state.pack, state.implementLaunch);
        state.last = stopped.result;
        state.busy = null;
        state.implementLaunch = null;
        pushActivity(state, stopped.message, "ok");
        await sendJson(res, { ...(await snapshot(state)), message: stopped.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Stop failed.",
          },
          err instanceof StopImplementLockedError || err instanceof AgentAnswersError ? 409 : 500,
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

    if (req.method === "POST" && url.pathname === "/api/agent-answers") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (state.busy) {
        sendJson(res, { ...(await snapshot(state)), error: "Another action is already running." }, 409);
        return;
      }
      const body = await readJson(req);
      const raw = body["answers"];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        sendJson(res, { error: "answers must be an object of question id to value." }, 400);
        return;
      }
      const answers: Record<string, string> = {};
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        answers[id] = String(value ?? "");
      }
      const skipAll = body["skipAll"] === true;
      const adapter = parseAdapterId(body["adapter"]) ?? "cursor";
      try {
        const round = await readAgentQuestions(state.pack);
        const logChannel: ActivityChannel = round?.channel === "author" ? "author" : "implement";
        const answered = await answerAgentQuestions(state.pack, answers, {
          adapter,
          skipAll,
          onLogLine: (line) => pushActivity(state, line, "info", logChannel),
        });
        state.last = answered.result;
        const summary = Object.entries(answers)
          .filter(([, value]) => value.trim())
          .map(([id, value]) => `${id}: ${value.trim()}`)
          .join("; ");
        pushActivity(
          state,
          summary ? `Owner answered. ${summary}` : skipAll ? "Owner skipped this round." : "Owner answered. Continuing.",
          "ok",
          answered.channel === "author" ? "author" : "implement",
        );
        if (answered.launch?.finished) {
          state.busy =
            answered.channel === "author" ? "author" : answered.channel === "improve" ? "improve" : "implement";
          if (answered.channel === "implement") state.implementLaunch = answered.launch;
          if (answered.channel === "author") state.authorLaunch = answered.launch;
          await yieldEventLoop();
          await sendJson(res, {
            ...(await snapshot(state)),
            started: true,
            message: answered.message,
          });
          if (answered.channel === "implement") {
            void runImplement(state, state.pack, answered.launch, adapter);
          } else if (answered.channel === "author") {
            void runAuthor(state, state.pack, answered.launch, adapter);
          } else {
            void runImproveWait(state, answered.launch);
          }
          return;
        }
        await sendJson(res, { ...(await snapshot(state)), message: answered.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not continue.",
          },
          err instanceof AgentAnswersError ? 400 : 409,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent-questions/discard") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      try {
        const discarded = await discardAgentQuestions(
          state.pack,
          discardedLaunch(state, (await readAgentQuestions(state.pack))?.channel),
        );
        state.last = discarded.result;
        state.busy = null;
        if (discarded.channel === "implement") state.implementLaunch = null;
        if (discarded.channel === "author") state.authorLaunch = null;
        pushActivity(
          state,
          discarded.message,
          "ok",
          discarded.channel === "author" ? "author" : "implement",
        );
        await sendJson(res, { ...(await snapshot(state)), message: discarded.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not discard questions.",
          },
          err instanceof AgentAnswersError ? 409 : 500,
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
      clearActivity(state, "prove");
      pushActivity(state, "Prove started.", "info", "prove");
      await yieldEventLoop();
      await sendJson(res, { ...(await snapshot(state)), started: true, message: "Prove started." });
      void runProve(state, pack);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/author/start") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      if (state.busy) {
        sendJson(res, { ...(await snapshot(state)), error: "Another action is already running." }, 409);
        return;
      }
      const body = await readJson(req);
      const description = String(body["description"] ?? "").trim();
      const adapter = parseAdapterId(body["adapter"]) ?? "cursor";
      try {
        clearActivity(state, "author");
        const started = await startAuthor(state.pack, description, {
          adapter,
          onLogLine: (line) => pushActivity(state, line, "info", "author"),
        });
        state.last = started.result;
        pushActivity(state, started.message, started.launch?.ok === false ? "error" : "ok", "author");
        if (started.launch?.finished) {
          state.busy = "author";
          state.authorLaunch = started.launch;
          await yieldEventLoop();
          await sendJson(res, {
            ...(await snapshot(state)),
            started: true,
            message: started.message,
          });
          void runAuthor(state, state.pack, started.launch, adapter);
          return;
        }
        await sendJson(res, { ...(await snapshot(state)), message: started.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not start authoring.",
          },
          err instanceof AuthorLockedError || err instanceof AgentAnswersError ? 409 : 500,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/author/stop") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      try {
        const stopped = await stopAuthor(state.pack, state.authorLaunch);
        state.last = stopped.result;
        state.busy = null;
        state.authorLaunch = null;
        pushActivity(state, stopped.message, "ok", "author");
        await sendJson(res, { ...(await snapshot(state)), message: stopped.message });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not stop authoring.",
          },
          500,
        );
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/author/artifact") {
      if (!state.pack) {
        sendJson(res, { error: "No pack selected." }, 400);
        return;
      }
      const body = await readJson(req);
      const filename = String(body["filename"] ?? "");
      const mime = String(body["mime"] ?? "");
      const data = String(body["data"] ?? "");
      try {
        const saved = await saveAuthorArtifact(state.pack, filename, mime, data);
        pushActivity(state, `Saved context/${saved}.`, "ok", "author");
        await sendJson(res, { ...(await snapshot(state)), filename: saved, message: `Saved context/${saved}.` });
      } catch (err) {
        sendJson(
          res,
          {
            ...(await snapshot(state)),
            error: err instanceof Error ? err.message : "Could not save the upload.",
          },
          err instanceof AuthorArtifactError ? 400 : 500,
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
  const authorRun = state.pack ? await readAuthorRun(state.pack) : null;
  const improveReview = state.pack ? await evaluateImproveReview(state.pack) : null;
  const agentQuestions = state.pack ? await readAgentQuestions(state.pack) : null;
  const openQuestions = isOpenQuestions(agentQuestions) ? agentQuestions : null;
  if (improveReview?.files.length && !state.implementActivity.some((line) => line.message === "Improve patch ready to review.")) {
    pushActivity(state, "Improve patch ready to review.", "ok");
  }
  if (openQuestions && openQuestions.channel === "author" && !state.authorActivity.some((line) => line.message === AGENT_QUESTIONS_WAITING)) {
    pushActivity(state, AGENT_QUESTIONS_WAITING, "info", "author");
  } else if (openQuestions && openQuestions.channel !== "author" && !state.implementActivity.some((line) => line.message === AGENT_QUESTIONS_WAITING)) {
    pushActivity(state, AGENT_QUESTIONS_WAITING);
  }
  let health = state.last ? applyImproveReviewGate(state.last.health, openQuestions ? null : improveReview) : null;
  if (health) health = applyAuthorGate(health, authorRun);
  if (health) health = applyAgentQuestionsGate(health, openQuestions);
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
    packList: await summarizePacks(packs),
    markdown: state.last?.markdown ?? "",
    health,
    spec: state.last?.spec ?? null,
    pipeline: pipelineView(health, Boolean(state.pack)),
    sections: sectionCatalog(),
    proofReport,
    hasApiKey: hasJevAccess(),
    productRepo: await inspectProductRepo(await inspectFrom(state)),
    implementActivity: state.implementActivity,
    proveActivity: state.proveActivity,
    authorActivity: state.authorActivity,
    busy: state.busy,
    improveReview,
    agentQuestions,
    authorRun,
  };
}

async function inspectFrom(state: AppState): Promise<string> {
  if (state.pack) return state.pack.root;
  const requirementsDir = await findRequirementsDir(state.cwd);
  return requirementsDir ?? path.join(state.cwd, "docs", "requirements");
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

async function runImproveWait(state: AppState, launch: LaunchAdapterResult): Promise<void> {
  try {
    if (launch.finished) await launch.finished;
    if (state.pack && isOpenQuestions(await readAgentQuestions(state.pack))) {
      pushActivity(state, AGENT_QUESTIONS_WAITING);
    }
  } catch (err) {
    pushActivity(state, err instanceof Error ? err.message : "Improve failed.", "error");
  } finally {
    state.busy = null;
  }
}

async function runImprove(state: AppState, pack: PackPaths, adapter: AdapterId): Promise<void> {
  try {
    const launched = await launchImprove(pack, { adapter });
    pushActivity(state, launched.message, launched.ok ? "ok" : "error");
    if (launched.finished) await launched.finished;
    if (isOpenQuestions(await readAgentQuestions(pack))) {
      pushActivity(state, AGENT_QUESTIONS_WAITING);
    }
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
  adapter: AdapterId,
): Promise<void> {
  try {
    const done = await finishImplement(pack, launch, adapter);
    if (state.pack?.root === pack.root) state.last = done.result;
    const waiting = done.message === AGENT_QUESTIONS_WAITING;
    pushActivity(state, done.message, done.result.health.build.state === "failed" ? "error" : waiting ? "info" : "ok");
  } catch (err) {
    pushActivity(state, err instanceof Error ? err.message : "Implement failed.", "error");
  } finally {
    if (state.busy === "implement") state.busy = null;
    if (state.implementLaunch === launch) state.implementLaunch = null;
  }
}

async function runAuthor(
  state: AppState,
  pack: PackPaths,
  launch: LaunchAdapterResult,
  adapter: AdapterId,
): Promise<void> {
  let current = launch;
  try {
    while (true) {
      const settled = await settleAuthor(pack, current);
      if (state.pack?.root === pack.root) state.last = settled.result;
      pushActivity(
        state,
        settled.message,
        settled.action === "done" ? "ok" : settled.action === "capped" ? "error" : "info",
        "author",
      );
      if (settled.action === "wait_questions" || settled.action === "done" || settled.action === "capped") {
        break;
      }
      if (settled.action !== "relaunch") break;
      const next = await launchAuthor(pack, {
        adapter,
        onLogLine: (line) => pushActivity(state, line, "info", "author"),
      });
      pushActivity(state, next.message, next.ok ? "ok" : "error", "author");
      if (!next.finished) break;
      current = next;
      state.authorLaunch = next;
    }
  } catch (err) {
    pushActivity(state, err instanceof Error ? err.message : "Authoring failed.", "error", "author");
  } finally {
    if (state.busy === "author") state.busy = null;
    if (state.authorLaunch === current || state.authorLaunch === launch) state.authorLaunch = null;
  }
}

function discardedLaunch(
  state: AppState,
  channel: string | undefined,
): LaunchAdapterResult | null {
  if (channel === "author") return state.authorLaunch;
  if (channel === "implement") return state.implementLaunch;
  return state.implementLaunch;
}

async function runProve(state: AppState, pack: PackPaths): Promise<void> {
  try {
    const proved = await provePack(pack, {
      onProgress: (message, level) => pushActivity(state, message, level, "prove"),
    });
    state.last = proved.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prove failed.";
    pushActivity(state, message, "error", "prove");
    if (err instanceof JevUnavailableError && state.pack) {
      state.last = await compilePack(state.pack);
    }
  } finally {
    state.busy = null;
  }
}

function clearActivity(state: AppState, channel?: ActivityChannel): void {
  if (!channel || channel === "implement") state.implementActivity = [];
  if (!channel || channel === "prove") state.proveActivity = [];
  if (!channel || channel === "author") state.authorActivity = [];
}

function pushActivity(
  state: AppState,
  message: string,
  level: ActivityLevel = "info",
  channel: ActivityChannel = "implement",
): void {
  const line: ActivityLine = { at: new Date().toISOString(), level, message };
  if (channel === "prove") {
    state.proveActivity = [...state.proveActivity, line].slice(-80);
    return;
  }
  if (channel === "author") {
    state.authorActivity = [...state.authorActivity, line].slice(-80);
    return;
  }
  state.implementActivity = [...state.implementActivity, line].slice(-80);
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
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
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
