/**
 * Tests for the installer entrypoint watchdog (#3805). Without an overall
 * timeout, a headless run whose GUI nobody can reach dangles forever until the
 * host (Claude Cowork) kills the command — the user sees "running…" then a
 * timeout. runInstallerLoop turns that into a bounded, clean exit.
 *
 * Pins:
 *   - When the GUI `done` promise never resolves, the watchdog wins with
 *     outcome "timeout" after watchdogMs.
 *   - When `done` resolves first, outcome is "completed" (happy path unaffected).
 *   - With `watchdogMs = null` (the UNINSTALL flow), NO timeout racer exists, so
 *     a slow user is never cut off and never sees install guidance.
 *
 * New file (existing installer tests are left untouched).
 */
import { describe, it, expect } from "vitest";
import { runInstallerLoop } from "../../installer/installer-electron.js";
import type { InstallerGuiHandle } from "../../installer/installer-gui.js";

function fakeHandle(done: Promise<void>): InstallerGuiHandle {
  return { url: "http://127.0.0.1:0/", done, close: async () => undefined };
}

describe("runInstallerLoop — watchdog", () => {
  it("fires with outcome 'timeout' when the GUI never completes", async () => {
    // A done promise that never resolves — the headless dangle the bug is about.
    const neverDone = new Promise<void>(() => undefined);
    const result = await runInstallerLoop(fakeHandle(neverDone), 30);
    expect(result.outcome).toBe("timeout");
  });

  it("returns 'completed' when the install finishes before the watchdog", async () => {
    const result = await runInstallerLoop(fakeHandle(Promise.resolve()), 5_000);
    expect(result.outcome).toBe("completed");
  });

  it("never times out the uninstall flow (watchdogMs = null)", async () => {
    // The uninstaller has no browser step and waits for the user to pick
    // clients. With the watchdog disabled, a `done` that takes a while still
    // resolves as "completed" — there is no timeout racer to cut it off.
    const slowDone = new Promise<void>((resolve) => setTimeout(resolve, 40));
    const result = await runInstallerLoop(fakeHandle(slowDone), null);
    expect(result.outcome).toBe("completed");
  });
});
