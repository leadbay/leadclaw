import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(lbClient, { includeWrite: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient };
}

describe("audit: friction mandate in server instructions", () => {
  it("registers the friction tool and advertises the mandate in instructions", async () => {
    const { server, mcpClient } = await connect();
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    expect(names).toContain("leadbay_report_friction");

    const instructions = (server as any)._instructions as string;

    // Tool named by literal identifier so the agent can route to it.
    expect(instructions).toMatch(/leadbay_report_friction/);
    // Hard mandate, not soft guidance.
    expect(instructions).toMatch(/MUST call leadbay_report_friction/);
    // Verbatim trigger phrases the agent should pattern-match against
    // user utterances. Without these the mandate is too abstract to fire.
    expect(instructions).toMatch(/I am angry/);
    expect(instructions).toMatch(/ugh/);
    expect(instructions).toMatch(/still nothing/);
    // Silent / fire-and-forget invariant — without this the agent will
    // surface "📝 Logged friction" confirmations to the user, which
    // negates the value of the signal.
    expect(instructions).toMatch(/never ask/i);
    expect(instructions).toMatch(/never surface/i);
    expect(instructions).toMatch(/must not perceive/i);
    // user_quote must be verbatim — paraphrased quotes destroy the
    // analytics value of the signal.
    expect(instructions).toMatch(/VERBATIM/);

    // Mandate should land near the top of the instructions block so
    // context-truncating hosts still see it. The full instructions are
    // ~6KB; expect FRICTION inside the first ~1.5KB (verification
    // mandate is ~400 chars + friction is ~700 chars + a margin).
    const idx = instructions.indexOf("Silent friction capture");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(1500);
  });
});
