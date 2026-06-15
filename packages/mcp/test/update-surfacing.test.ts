/**
 * Proactive update surfacing (product#3742).
 *
 * The auto-update CHECK already runs at boot + on every tool call and caches
 * an UpdateInfo. The gap this suite guards: a fresh session rarely calls
 * leadbay_account_status, so the cached proposal must ALSO ride along on the
 * first ordinary tool result of the session — otherwise the user never sees
 * the "newer version available" prompt.
 *
 * Two delivery channels, both exercised here against the real JSON-RPC server:
 *   1. leadbay_account_status → top-level `update_available` (its outputSchema
 *      documents the field; always reflects the cache).
 *   2. ANY other tool → `_meta.update_available` on the FIRST such response of
 *      the session, gated once-per-version so we don't decorate every call.
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";
import { vi } from "vitest";

vi.mock("node:https", () => httpsMockFactory());

import type { Tool } from "@leadbay/core";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { UpdateStateStore } from "../src/update-state.js";
import {
  checkForUpdate,
  __resetUpdateCacheForTests,
} from "../src/update-check.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const CURRENT = "0.19.2";
const LATEST = "0.20.0";
const DXT_URL =
  "https://github.com/leadbay/leadclaw/releases/download/mcp-v0.20.0/leadbay-0.20.0.dxt";
const MCPB_URL =
  "https://github.com/leadbay/leadclaw/releases/download/mcp-v0.20.0/leadbay-0.20.0.mcpb";
const RELEASE_URL = "https://github.com/leadbay/leadclaw/releases/tag/mcp-v0.20.0";

// A fetch stub returning one "newer release published" GitHub payload — enough
// to populate the in-process update cache via checkForUpdate().
function fakeReleaseFetch(): typeof fetch {
  return (async () => {
    const headers = new Headers();
    headers.set("etag", '"abc"');
    return {
      status: 200,
      headers,
      json: async () => ({
        tag_name: `mcp-v${LATEST}`,
        html_url: RELEASE_URL,
        // Both assets present — the picker must prefer .dxt.
        assets: [
          { name: "leadbay-0.20.0.mcpb", browser_download_url: MCPB_URL },
          { name: "leadbay-0.20.0.dxt", browser_download_url: DXT_URL },
        ],
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

// Trivial JSON-returning tool — stands in for "any non-account_status tool"
// without coupling the test to a real composite's HTTP shape.
const pingTool: Tool = {
  name: "leadbay_ping_test",
  description: "test-only ping",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { pong: { type: "boolean" } },
    required: ["pong"],
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ pong: true }),
};

// Returns a Leadbay error envelope — the CallTool handler serializes these as
// a bare { content, isError } with NO _meta / structuredContent. The update
// proposal must NOT be consumed by such a result (regression guard for the
// "first call errors → proposal invisible all session" bug).
const errorTool: Tool = {
  name: "leadbay_error_test",
  description: "test-only error",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: async () => ({
    error: true as const,
    code: "QUOTA_EXCEEDED",
    message: "quota hit",
    hint: "retry later",
  }),
};

async function seedUpdateCache(stateStore: UpdateStateStore) {
  await checkForUpdate({
    currentVersion: CURRENT,
    stateStore,
    telemetry: {} as any,
    force: true,
    releasesUrl: "https://example.test/releases/latest",
    fetchImpl: fakeReleaseFetch(),
  });
}

async function connectWithUpdates(stateStore: UpdateStateStore) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeWrite: true,
    version: CURRENT,
    updateStateStore: stateStore,
    extraTools: [pingTool, errorTool],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

function newStore() {
  return new UpdateStateStore({ backend: "memory" });
}

beforeEach(() => {
  resetHttpMock();
  __resetUpdateCacheForTests();
});

describe("proactive update surfacing — non-account_status tools (product#3742)", () => {
  it("rides _meta.update_available on the FIRST ordinary tool result", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as any;
    expect(structured.pong).toBe(true);
    expect(structured._meta?.update_available).toMatchObject({
      current_version: CURRENT,
      latest_version: LATEST,
      // .dxt preferred over .mcpb when both assets are published.
      install_url: DXT_URL,
      release_url: RELEASE_URL,
    });
  });

  it("does NOT re-decorate subsequent calls for the same version (surfaces once)", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const first = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((first.structuredContent as any)._meta?.update_available).toBeDefined();

    const second = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((second.structuredContent as any)._meta?.update_available).toBeUndefined();
  });

  it("does not attach anything when no update is cached", async () => {
    const store = newStore();
    // No seedUpdateCache → cache stays null.
    const { mcpClient } = await connectWithUpdates(store);

    const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((result.structuredContent as any)._meta?.update_available).toBeUndefined();
  });

  // Regression: an error envelope is serialized as a bare { content, isError }
  // with no _meta — so attaching there would burn the once-per-version gate
  // while dropping the field, making the proposal invisible for the rest of
  // the session. The proposal must survive a first-call error and surface on
  // the next non-error tool result instead.
  it("does NOT consume the proposal when the first tool call errors", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    const errored = await mcpClient.callTool({ name: "leadbay_error_test", arguments: {} });
    expect(errored.isError).toBe(true);

    // The next successful tool call must still carry the proposal.
    const ok = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((ok.structuredContent as any)._meta?.update_available).toMatchObject({
      latest_version: LATEST,
      install_url: DXT_URL,
    });
  });
});

describe("update surfacing — account_status keeps top-level field", () => {
  it("attaches update_available as a top-level field", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          email: "a@b.co",
          name: "Tester",
          organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/organizations\/org-1\/quota_status/,
        status: 200,
        body: { plan: "pro", org: { spend: [], resources: [] } },
      },
    ]);

    const result = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "what's my account status" },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as any;
    expect(structured.update_available).toMatchObject({
      current_version: CURRENT,
      latest_version: LATEST,
    });
  });

  it("once account_status surfaces a version, a later ordinary tool does NOT re-prompt it", async () => {
    const store = newStore();
    await seedUpdateCache(store);
    const { mcpClient } = await connectWithUpdates(store);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { email: "a@b.co", name: "T", organization: { id: "org-1", name: "Org" } },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/quota_status",
        status: 200,
        body: { plan: "pro" },
      },
    ]);

    const acct = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "what's my account status" },
    });
    expect((acct.structuredContent as any).update_available).toBeDefined();

    // The once-per-version gate is shared: the ordinary tool should NOT
    // re-surface a version account_status already prompted.
    const ping = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
    expect((ping.structuredContent as any)._meta?.update_available).toBeUndefined();
  });
});
