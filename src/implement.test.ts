import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  adapterInstructions,
  assertImplementAllowed,
  IMPLEMENT_SANDBOX_CAP,
  implementPrompt,
  improvePrompt,
  ImplementLockedError,
  isSandboxOnceStart,
  fixFromProofPrompt,
  launchAdapter,
  summarizeAgentLine,
} from "./implement.js";
import { emptyReady } from "./ready.js";
import type { CompileResult } from "./types.js";

function result(readyState: "not_yet" | "ready"): CompileResult {
  return {
    spec: null,
    markdown: "",
    health: {
      requirementId: "demo",
      spec: { state: "valid", findings: [] },
      ready:
        readyState === "ready"
          ? { state: "ready", reason: "passed", blockers: 0, nits: 0, findings: [] }
          : emptyReady("no_api_key"),
      build: { state: "not_yet" },
      proof: { state: "not_yet", runtime: false, findings: [] },
      nextAction: { id: "implement", label: "Implement this requirement", enabled: true },
      howThisIsGoing: "",
    },
  };
}

function fakeSpawn(calls: string[][]) {
  return ((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => undefined;
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as typeof import("node:child_process").spawn;
}

describe("implement lock", () => {
  it("refuses when Ready is not Ready", () => {
    expect(() => assertImplementAllowed(result("not_yet"))).toThrow(ImplementLockedError);
    try {
      assertImplementAllowed(result("not_yet"));
    } catch (err) {
      expect(err).toBeInstanceOf(ImplementLockedError);
      expect((err as ImplementLockedError).code).toBe("ready_gate");
    }
  });

  it("allows launch when Ready is Ready", () => {
    expect(() => assertImplementAllowed(result("ready"))).not.toThrow();
  });

  it("describes both adapters", () => {
    expect(adapterInstructions("cursor", "derived/implement-brief.md")).toContain("Cursor");
    expect(adapterInstructions("manual", "derived/implement-brief.md")).toContain("does not start an agent");
  });

  it("manual adapter always succeeds; Cursor needs a product repo", async () => {
    await expect(launchAdapter("manual", null, "brief.md")).resolves.toMatchObject({ ok: true });
    await expect(launchAdapter("cursor", null, "brief.md")).resolves.toMatchObject({ ok: false });
  });

  it("puts the brief path in the Cursor agent prompt", () => {
    expect(implementPrompt("/repo/derived/implement-brief.md")).toContain("/repo/derived/implement-brief.md");
    expect(implementPrompt("/repo/derived/implement-brief.md")).toContain("fixtures/runtime.yaml");
    expect(implementPrompt("/repo/derived/implement-brief.md")).toContain("fixtures/personas.yaml");
    expect(implementPrompt("/repo/derived/implement-brief.md")).toContain("README.md");
    expect(implementPrompt("/repo/derived/implement-brief.md")).toContain("At most 3 npx ampx sandbox --once");
    expect(implementPrompt("/repo/derived/implement-brief.md", "amplify-gen2")).toContain("npx ampx sandbox --once");
    expect(implementPrompt("/repo/derived/implement-brief.md", "amplify-gen2")).toContain("REPLACE_VIA_SANDBOX");
    expect(implementPrompt("/repo/derived/implement-brief.md", "amplify-gen2")).toContain("does not read .env");
    expect(implementPrompt("/repo/derived/implement-brief.md", "amplify-gen2")).toContain("npx ampx configure profile");
    expect(improvePrompt("/repo/derived/improve-brief.md")).toContain("/repo/derived/improve-brief.md");
    expect(fixFromProofPrompt("/repo/derived/fix-from-proof-brief.md", "/repo/derived/proof-report.md", "/repo/derived/implement-brief.md")).toContain(
      "proof-report.md",
    );
    expect(fixFromProofPrompt("/repo/derived/fix-from-proof-brief.md", "/repo/derived/proof-report.md", "/repo/derived/implement-brief.md")).toContain(
      "Do not edit requirement.md",
    );
    expect(fixFromProofPrompt("/repo/derived/fix-from-proof-brief.md", "/repo/derived/proof-report.md", "/repo/derived/implement-brief.md")).toContain(
      "At most 3 npx ampx sandbox --once",
    );
  });

  it("cursor adapter opens the repo and starts an agent with the brief", async () => {
    const calls: string[][] = [];
    const launched = await launchAdapter("cursor", "/tmp/invoice-desk", "/tmp/invoice-desk/derived/implement-brief.md", {
      spawn: fakeSpawn(calls),
      resolveBin: () => "/fake/cursor",
      agentStatus: () => "Logged in as test@example.test",
      settleMs: 0,
      platform: "darwin",
    });
    expect(launched.ok).toBe(true);
    expect(calls[0]).toEqual(["open", "-a", "Cursor", "/tmp/invoice-desk"]);
    expect(calls[1]?.slice(0, 6)).toEqual([
      "/fake/cursor",
      "agent",
      "--workspace",
      "/tmp/invoice-desk",
      "--trust",
      "--force",
    ]);
    expect(calls[1]?.at(-1)).toContain("implement-brief.md");
    expect(calls[1]).toContain("--output-format");
    expect(calls[1]).toContain("stream-json");
  });

  it("can start the agent without opening the IDE", async () => {
    const calls: string[][] = [];
    const launched = await launchAdapter("cursor", "/tmp/invoice-desk", "/tmp/invoice-desk/derived/improve-brief.md", {
      spawn: fakeSpawn(calls),
      resolveBin: () => "/fake/cursor",
      settleMs: 0,
      platform: "darwin",
      openIde: false,
      prompt: improvePrompt("/tmp/invoice-desk/derived/improve-brief.md"),
    });
    expect(launched.ok).toBe(true);
    expect(calls[0]?.slice(0, 3)).toEqual(["/fake/cursor", "agent", "--workspace"]);
    expect(calls.some((call) => call[0] === "open")).toBe(false);
  });

  it("writes agent stdout to implement-agent.log as it arrives", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-agent-log-"));
    const brief = path.join(dir, "derived", "implement-brief.md");
    const lines: string[] = [];
    try {
      await mkdir(path.join(dir, "derived"), { recursive: true });
      const launched = await launchAdapter("cursor", dir, brief, {
        spawn: ((cmd: string, args: string[]) => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
            unref: () => void;
          };
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.unref = () => undefined;
          queueMicrotask(() => {
            child.emit("spawn");
            child.stdout.write("scaffolding Next.js\n");
            child.stdout.write(
              `${JSON.stringify({
                type: "tool_call",
                subtype: "started",
                tool_call: { writeToolCall: { args: { path: "src/app/page.tsx" } } },
              })}\n`,
            );
            child.stderr.write("npm install\n");
          });
          return child;
        }) as typeof import("node:child_process").spawn,
        resolveBin: () => "/fake/cursor",
        settleMs: 30,
        openIde: false,
        onLogLine: (line) => lines.push(line),
      });
      expect(launched.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const log = await readFile(path.join(dir, "derived", "implement-agent.log"), "utf8");
      expect(log).toContain("scaffolding Next.js");
      expect(log).toContain("npm install");
      expect(lines).toContain("scaffolding Next.js");
      expect(lines).toContain("Writing src/app/page.tsx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("turns stream-json events into Activity lines", () => {
    expect(
      summarizeAgentLine(
        JSON.stringify({ type: "system", subtype: "init", model: "Composer" }),
      ),
    ).toBe("Cursor agent connected (Composer).");
    expect(
      summarizeAgentLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Scaffolding the app." }] },
        }),
      ),
    ).toBe("Agent: Scaffolding the app.");
    expect(
      summarizeAgentLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          tool_call: { writeToolCall: { args: { path: "README.md" } } },
        }),
      ),
    ).toBe("Writing README.md");
    expect(
      summarizeAgentLine(
        JSON.stringify({ type: "result", subtype: "success", duration_ms: 125000, is_error: false }),
      ),
    ).toBe("Cursor agent finished in 2m 5s.");
    expect(summarizeAgentLine(JSON.stringify({ type: "user", message: { content: [] } }))).toBeNull();
    expect(summarizeAgentLine("Connection lost, reconnecting…")).toBe(
      "Connection lost, reconnecting…",
    );
  });

  it("counts a started ampx sandbox --once tool call", () => {
    expect(
      isSandboxOnceStart(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          tool_call: { shellToolCall: { args: { command: "npx ampx sandbox --once" } } },
        }),
      ),
    ).toBe(true);
    expect(
      isSandboxOnceStart(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          tool_call: { shellToolCall: { args: { command: "npx ampx sandbox --once" } } },
        }),
      ),
    ).toBe(false);
    expect(isSandboxOnceStart("npx ampx sandbox --once")).toBe(true);
  });

  it("stops the agent after too many sandbox deploys", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "req0-sandbox-cap-"));
    const brief = path.join(dir, "derived", "implement-brief.md");
    const lines: string[] = [];
    const killed: string[] = [];
    try {
      await mkdir(path.join(dir, "derived"), { recursive: true });
      const launched = await launchAdapter("cursor", dir, brief, {
        spawn: (() => {
          const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
            pid: number;
            kill: (signal?: string) => boolean;
            unref: () => void;
          };
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.pid = 4242;
          child.unref = () => undefined;
          child.kill = () => {
            killed.push("term");
            queueMicrotask(() => child.emit("close", 15));
            return true;
          };
          queueMicrotask(() => {
            child.emit("spawn");
            const start = JSON.stringify({
              type: "tool_call",
              subtype: "started",
              tool_call: { shellToolCall: { args: { command: "cd app && npx ampx sandbox --once" } } },
            });
            child.stdout.write(`${start}\n${start}\n${start}\n`);
          });
          return child;
        }) as typeof import("node:child_process").spawn,
        resolveBin: () => "/fake/cursor",
        settleMs: 40,
        openIde: false,
        sandboxMax: 2,
        maxMs: 0,
        onLogLine: (line) => lines.push(line),
      });
      expect(launched.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(killed.length).toBeGreaterThan(0);
      expect(launched.stop?.reason).toBe(IMPLEMENT_SANDBOX_CAP);
      expect(lines).toContain(IMPLEMENT_SANDBOX_CAP);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses Cursor launch when the agent is not logged in", async () => {
    const calls: string[][] = [];
    const launched = await launchAdapter("cursor", "/tmp/invoice-desk", "/tmp/invoice-desk/derived/implement-brief.md", {
      spawn: fakeSpawn(calls),
      resolveBin: () => "/fake/cursor",
      agentStatus: () => "Not logged in",
      settleMs: 0,
    });
    expect(launched.ok).toBe(false);
    expect(launched.message).toContain('"/fake/cursor" agent login');
    expect(calls).toEqual([]);
  });
});
