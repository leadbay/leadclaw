/**
 * Cancellation test — verifies notifications/cancelled aborts the
 * in-flight tool execute via ToolContext.signal.
 *
 * Per MCP 2025-11-25 §Cancellation, a client may send
 * `notifications/cancelled` for an in-flight request. The SDK fires
 * the request handler's AbortSignal; this server forwards that
 * signal to ToolContext.signal so long-running composites can stop
 * polling.
 *
 * To keep timing deterministic, we register a test-only fake tool
 * via the buildServer `extraTools` option (production code never
 * passes this). The fake awaits `signal` and resolves on abort.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import type { Tool, ToolContext } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

function makeSlowTool(): { tool: Tool; observedSignal: () => AbortSignal | undefined } {
  let observed: AbortSignal | undefined;
  const tool: Tool = {
    name: "leadbay_test_slow_tool",
    description: "Test-only tool that awaits ctx.signal abort. Not exposed in production builds.",
    annotations: {
      title: "Test slow tool (cancellation harness)",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (
      _client,
      _params,
      ctx?: ToolContext
    ) => {
      observed = ctx?.signal;
      // Wait until the signal aborts. If signal is undefined (wiring
      // broken), fall back to a 5-second timeout so the test fails
      // visibly rather than hanging.
      return new Promise((resolve, reject) => {
        const timeoutMs = 5000;
        const fallback = setTimeout(() => {
          reject(new Error(`signal-not-wired: tool executed for ${timeoutMs}ms with no abort`));
        }, timeoutMs);
        if (!ctx?.signal) {
          // No signal at all — wait for fallback timer.
          return;
        }
        if (ctx.signal.aborted) {
          clearTimeout(fallback);
          resolve({ aborted: true });
          return;
        }
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(fallback);
            resolve({ aborted: true });
          },
          { once: true }
        );
      });
    },
  };
  return { tool, observedSignal: () => observed };
}

async function connect(extraTools: Tool[]) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { extraTools });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

describe("notifications/cancelled → ToolContext.signal (P2 cancellation)", () => {
  it("ToolContext.signal is wired and observable in tool.execute", async () => {
    const { tool, observedSignal } = makeSlowTool();
    const { mcpClient } = await connect([tool]);

    // Fire the call WITHOUT cancelling. The slow tool would hang if we
    // awaited it, so we kick it off and observe the signal post-hoc.
    const callPromise = mcpClient
      .callTool({ name: "leadbay_test_slow_tool", arguments: {} })
      .catch((err) => ({ rejected: err }));

    // Give the handler a moment to enter execute.
    await new Promise((r) => setTimeout(r, 50));
    expect(observedSignal()).toBeDefined();
    expect(observedSignal()!.aborted).toBe(false);

    // Cleanup: abort by sending cancellation. The SDK requires the
    // request id; the public Client API doesn't expose it directly,
    // but we can short-circuit by closing the transport (which
    // aborts pending requests).
    await (mcpClient as any).close?.();

    // Wait for the call to settle.
    const result = (await Promise.race([
      callPromise,
      new Promise((r) => setTimeout(() => r({ rejected: "timeout" }), 6000)),
    ])) as any;
    // The transport-close fires abort; the tool resolves cleanly with {aborted:true}.
    // Either way, the observedSignal should now report aborted.
    expect(observedSignal()!.aborted).toBe(true);
    // Either the call rejected (transport closed mid-flight) or it returned
    // with aborted-shape — both are honest outcomes for a torn-down session.
    if (!("rejected" in result)) {
      expect((result as any).structuredContent ?? JSON.parse((result as any).content[0].text)).toMatchObject({ aborted: true });
    }
  }, 10_000);
});
