/**
 * Behavioral regression for OAuth-broken-on-Windows, part 2 (issue #3839).
 *
 * On Windows, openInBrowser used to resolve the moment `cmd.exe` was CREATED
 * (the "spawn" event) — before its `start` builtin actually handed the URL to a
 * browser. A silent no-op (no default-browser association / locked-down shell)
 * therefore went undetected: nothing opened, yet the flow reported success.
 *
 * The fix makes the Windows branch WAIT for each launcher's exit code:
 *   • exit 0 / null      → launched OK
 *   • non-zero exit      → failed → try the next candidate (cmd → rundll32 → …)
 *   • no exit by budget  → still running → assume dispatched → success
 * macOS/Linux keep resolve-on-"spawn" (the #3805 headless-hang fix — those
 * launchers ARE the hand-off), and must NOT wait for exit.
 *
 * These tests mock node:child_process.spawn with a controllable fake child, so
 * they exercise the real openInBrowser control flow without touching a browser.
 * New file — no existing test is modified.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// A fake ChildProcess we can drive: emit "spawn"/"exit"/"error" on demand.
class FakeChild extends EventEmitter {
  public pid = 4242;
  public unref = vi.fn();
  public killed = false;
  // Convenience drivers used by the tests.
  emitSpawn() {
    this.emit("spawn");
  }
  emitExit(code: number | null) {
    this.emit("exit", code);
  }
  emitError(err: Error) {
    this.emit("error", err);
  }
}

// Records of every spawn() call + the fake child it returned. Declared with var
// so the hoisted vi.mock factory can see it (vi.mock is lifted above imports).
// eslint-disable-next-line no-var
var spawnCalls: Array<{ cmd: string; args: string[]; opts: any; child: FakeChild }>;
spawnCalls = [];

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], opts: any) => {
    const child = new FakeChild();
    spawnCalls.push({ cmd, args, opts, child });
    return child;
  },
}));

// Import AFTER the mock is registered so oauth.ts's `spawn` is the fake.
const { openInBrowser } = await import("../../src/oauth.js");

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

// Drive the Nth spawned child once it exists (spawn is synchronous inside
// openInBrowser, so a microtask flush is enough to observe each new child).
async function nextChild(index: number): Promise<FakeChild> {
  for (let i = 0; i < 50 && spawnCalls.length <= index; i++) {
    await Promise.resolve();
  }
  if (spawnCalls.length <= index) throw new Error(`child ${index} never spawned`);
  return spawnCalls[index].child;
}

const URL = "https://leadbay.app/oauth/authorize?client_id=99&state=xyz";

beforeEach(() => {
  spawnCalls = [];
  setPlatform("win32");
  process.env.SystemRoot = "C:\\Windows";
});
afterEach(() => {
  setPlatform(realPlatform);
  vi.useRealTimers();
});

describe("openInBrowser — Windows exit-wait (#3839)", () => {
  it("cmd exit 0 → resolves immediately; later candidates NOT spawned", async () => {
    const p = openInBrowser(URL);
    const cmd = await nextChild(0);
    cmd.emitSpawn();
    cmd.emitExit(0);
    await expect(p).resolves.toBeUndefined();
    // Only the first (cmd.exe) candidate ran — no rundll32/powershell.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("cmd no-op (exit 1) → falls through to rundll32 (exit 0) → resolves", async () => {
    const p = openInBrowser(URL);
    const cmd = await nextChild(0);
    cmd.emitSpawn();
    cmd.emitExit(1); // silent no-op — the #3839 shape

    // The absolute cmd.exe failed; the loop advances. The bare-`cmd` fallback
    // is candidate 2 — fail it too so we reach rundll32.
    const bareCmd = await nextChild(1);
    bareCmd.emitSpawn();
    bareCmd.emitExit(1);

    const rundll = await nextChild(2);
    expect(rundll.constructor).toBe(FakeChild);
    expect(spawnCalls[2].cmd).toBe("C:\\Windows\\System32\\rundll32.exe");
    expect(spawnCalls[2].args).toEqual(["url.dll,FileProtocolHandler", URL]);
    rundll.emitSpawn();
    rundll.emitExit(0);

    await expect(p).resolves.toBeUndefined();
  });

  it("every candidate exits non-zero → openInBrowser rejects (openFailed upstream)", async () => {
    const p = openInBrowser(URL);
    // Fail all four candidates in order.
    for (let i = 0; i < 4; i++) {
      const c = await nextChild(i);
      c.emitSpawn();
      c.emitExit(1);
    }
    await expect(p).rejects.toBeTruthy();
    expect(spawnCalls).toHaveLength(4);
  });

  it("cmd never exits → resolves via the exit-wait timeout (assumed launched)", async () => {
    vi.useFakeTimers();
    const p = openInBrowser(URL);
    const cmd = await nextChild(0);
    cmd.emitSpawn(); // spawned but never exits
    // Advance past the cmd budget (800ms). The timeout resolves as success.
    await vi.advanceTimersByTimeAsync(900);
    await expect(p).resolves.toBeUndefined();
    // No fallthrough — the timeout is treated as success, so rundll32 isn't tried.
    expect(spawnCalls).toHaveLength(1);
    expect(cmd.unref).toHaveBeenCalled();
  });

  it("passes detached:false + windowsVerbatimArguments on win32", async () => {
    const p = openInBrowser(URL);
    const cmd = await nextChild(0);
    expect(spawnCalls[0].opts.detached).toBe(false);
    expect(spawnCalls[0].opts.windowsVerbatimArguments).toBe(true);
    cmd.emitSpawn();
    cmd.emitExit(0);
    await p;
  });

  it("ENOENT on a launcher → falls through to the next candidate", async () => {
    const p = openInBrowser(URL);
    const cmd = await nextChild(0);
    cmd.emitError(Object.assign(new Error("spawn cmd.exe ENOENT"), { code: "ENOENT" }));
    const bareCmd = await nextChild(1);
    bareCmd.emitSpawn();
    bareCmd.emitExit(0);
    await expect(p).resolves.toBeUndefined();
  });
});

describe("openInBrowser — POSIX resolves on spawn without waiting for exit (protects #3805)", () => {
  it("linux: a child that emits spawn but never exits still resolves + detaches", async () => {
    setPlatform("linux");
    const p = openInBrowser(URL);
    const child = await nextChild(0);
    child.emitSpawn(); // NO exit event — POSIX must not wait for it
    await expect(p).resolves.toBeUndefined();
    expect(spawnCalls[0].opts.detached).toBe(true); // POSIX detaches
    expect(child.unref).toHaveBeenCalled();
    expect(spawnCalls).toHaveLength(1);
  });
});
