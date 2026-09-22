import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  adapterInstructions,
  assertImplementAllowed,
  implementPrompt,
  ImplementLockedError,
  launchAdapter,
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
