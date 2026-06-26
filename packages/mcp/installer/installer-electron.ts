import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printHostedMcpHelp } from "./install-shared.js";
import type { InstallerGuiHandle } from "./installer-gui.js";

// Overall ceiling on a guided GUI run. Long enough for a human to finish OAuth
// + client selection once the browser opened; short enough to beat a chat-agent
// host's own command timeout (Claude Cowork) with a clean, actionable message
// instead of a silent hang (#3805).
export const WATCHDOG_MS = 120_000;

export interface InstallerLoopResult {
  /** "completed" = install finished, "signal" = SIGINT/SIGTERM, "timeout" = watchdog fired. */
  outcome: "completed" | "signal" | "timeout";
}

/**
 * Race the GUI's done signal against an interrupt and an optional overall
 * watchdog. The watchdog only makes sense for the INSTALL flow: without it, a
 * headless run whose OAuth/browser GUI nobody can reach dangles forever until
 * the host kills it ("timeout" in Claude), and the watchdog turns that into a
 * clean exit with the hosted-MCP fallback guidance.
 *
 * Pass `watchdogMs = null` to disable it — the UNINSTALL flow has no
 * OAuth/browser step and legitimately waits for the user to review and select
 * clients to remove, so it must stay open until the user finishes or interrupts.
 */
export async function runInstallerLoop(
  handle: InstallerGuiHandle,
  watchdogMs: number | null = WATCHDOG_MS
): Promise<InstallerLoopResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const racers: Array<Promise<InstallerLoopResult>> = [
      handle.done.then(() => ({ outcome: "completed" as const })),
      new Promise<InstallerLoopResult>((resolve) => {
        process.once("SIGINT", () => resolve({ outcome: "signal" }));
        process.once("SIGTERM", () => resolve({ outcome: "signal" }));
      }),
    ];
    if (watchdogMs !== null) {
      racers.push(
        new Promise<InstallerLoopResult>((resolve) => {
          timer = setTimeout(() => resolve({ outcome: "timeout" }), watchdogMs);
        })
      );
    }
    return await Promise.race<InstallerLoopResult>(racers);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Always try to launch the GUI + open the browser — the installer does the
  // whole job once a browser is up, and a chat-agent terminal (Claude Cowork)
  // can often open one. We do NOT guess "headless" and refuse to start: the
  // watchdog below is the safety net for the case where nothing ever opens.
  const { startInstallerGui, startUninstallerGui } = await import("./installer-gui.js");
  const opts = { openBrowser: !args.includes("--no-open") };
  const isUninstall = args.includes("--uninstall");
  const handle = isUninstall
    ? await startUninstallerGui(opts)
    : await startInstallerGui(opts);

  // The watchdog only guards the install flow (OAuth + browser can dangle when
  // no browser opens). Uninstall has no browser step and legitimately waits for
  // the user to review/select clients, so it stays open until done or Ctrl+C.
  const { outcome } = await runInstallerLoop(handle, isUninstall ? null : WATCHDOG_MS);
  await handle.close().catch(() => undefined);

  if (outcome === "timeout") {
    process.stderr.write("\nInstaller timed out waiting for the browser flow.\n");
    printHostedMcpHelp();
    process.exit(1);
  }
  const verb = isUninstall ? "Uninstall" : "Installation";
  process.stderr.write(outcome === "completed" ? `\n${verb} complete. Exiting.\n` : "\nExiting.\n");
}

const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`leadbay-mcp-installer: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
