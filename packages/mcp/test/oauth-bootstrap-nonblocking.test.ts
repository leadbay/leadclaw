/**
 * Non-blocking OAuth bootstrap (Claude Desktop .dxt install) — 0.21.2.
 *
 * Root cause guarded: the bundled stdio server used to run the full
 * interactive browser OAuth flow (up to 5 min) BEFORE answering the MCP
 * `initialize` handshake, so Claude Desktop timed out the connection and
 * showed "Unable to connect to extension server". The fix:
 *
 *   - resolveClientFromEnv returns a REAL tokenless client with
 *     authState "pending" immediately (no await on OAuth).
 *   - buildServer takes a bootstrapStatus() getter; the CallTool handler
 *     returns AUTH_PENDING (or AUTH_MISSING when the browser couldn't open)
 *     while unauthenticated, then executes normally once the background flow
 *     lands a token on the same client instance (client.setToken).
 *
 * These tests pin all three. New file — existing server.test.ts and
 * oauth.test.ts are left untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { resolveClientFromEnv } from "../src/bin.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect(opts: {
  client: LeadbayClient;
  bootstrapStatus?: () => "pending" | "browser_open_failed" | "done";
}) {
  const server = buildServer(opts.client, {
    includeWrite: true,
    bootstrapStatus: opts.bootstrapStatus,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => resetHttpMock());

describe("CallTool gate while bootstrap is pending", () => {
  it("returns AUTH_PENDING and does NOT hit the backend", async () => {
    // Declare zero endpoints — the harness throws if any HTTP is attempted,
    // so reaching the backend while pending would fail the test.
    const captured = mockHttp([]);
    const tokenless = new LeadbayClient(BASE, undefined as unknown as string);
    const { mcpClient } = await connect({
      client: tokenless,
      bootstrapStatus: () => "pending",
    });
    const res: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check my account" },
    });
    expect(res.isError).toBe(true);
    const text = res.content[0].text as string;
    expect(text).toMatch(/Signing you in to Leadbay/i);
    expect(text).toMatch(/browser window should have opened/i);
    expect(captured.requests).toHaveLength(0);
  });

  it("browser_open_failed → AUTH_MISSING with restart guidance", async () => {
    const captured = mockHttp([]);
    const tokenless = new LeadbayClient(BASE, undefined as unknown as string);
    const { mcpClient } = await connect({
      client: tokenless,
      bootstrapStatus: () => "browser_open_failed",
    });
    const res: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check my account" },
    });
    expect(res.isError).toBe(true);
    const text = res.content[0].text as string;
    expect(text).toMatch(/couldn.t open your browser/i);
    expect(text).toMatch(/restart the leadbay extension/i);
    expect(captured.requests).toHaveLength(0);
  });

  it("once the token lands on the live client, the gate opens (status flips to done)", async () => {
    // The getter reads client.isAuthenticated live — the exact seam the
    // background OAuth uses (client.setToken on the captured instance).
    const client = new LeadbayClient(BASE, undefined as unknown as string);
    const { mcpClient } = await connect({
      client,
      bootstrapStatus: () =>
        client.isAuthenticated ? "done" : "pending",
    });

    // Before token: gated, no backend call (harness throws on undeclared HTTP).
    const beforeMock = mockHttp([]);
    const pending: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check" },
    });
    expect(pending.isError).toBe(true);
    expect(pending.content[0].text).toMatch(/Signing you in to Leadbay/i);
    expect(beforeMock.requests).toHaveLength(0);

    // Background OAuth lands → mutate the SAME instance.
    client.setBaseUrl(BASE, "us");
    client.setToken("o.landed-token");

    // Now the gate is open: account_status reaches the backend. resolveMe ->
    // /users/me, then /organizations/{id}/quota_status.
    const afterMock = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { email: "x@leadbay.ai", organization: { id: "org1", name: "Org" } },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org1/quota_status",
        status: 200,
        body: {},
      },
    ]);
    const ok: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check" },
    });
    // Gate let it through: it is NOT the AUTH_PENDING envelope, and it actually
    // reached the backend (proving the live-instance token mutation works).
    expect(ok.content?.[0]?.text ?? "").not.toMatch(/Signing you in to Leadbay/i);
    expect(afterMock.requests.some((r) => r.path === "/1.5/users/me")).toBe(true);
  });

  it("no bootstrapStatus (normal config) → never gated as pending", async () => {
    const authed = new LeadbayClient(BASE, "u.real-token", "us");
    const { mcpClient } = await connect({ client: authed }); // no bootstrapStatus
    const captured = mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { email: "x@leadbay.ai", organization: { id: "org1", name: "Org" } },
      },
      {
        method: "GET",
        path: "/1.5/organizations/org1/quota_status",
        status: 200,
        body: {},
      },
    ]);
    const res: any = await mcpClient.callTool({
      name: "leadbay_account_status",
      arguments: { _triggered_by: "check" },
    });
    expect(res.content?.[0]?.text ?? "").not.toMatch(/Signing you in to Leadbay/i);
    expect(captured.requests.some((r) => r.path === "/1.5/users/me")).toBe(true);
  });
});

describe("resolveClientFromEnv — pending bootstrap path", () => {
  const SAVED: Record<string, string | undefined> = {};
  const KEYS = ["LEADBAY_OAUTH_BOOTSTRAP", "LEADBAY_TOKEN", "LEADBAY_REGION", "LEADBAY_BASE_URL"];
  beforeEach(() => {
    for (const k of KEYS) SAVED[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (SAVED[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED[k];
    }
  });

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  it("returns a real tokenless client with authState 'pending' (no blocking OAuth)", async () => {
    process.env.LEADBAY_OAUTH_BOOTSTRAP = "1";
    process.env.LEADBAY_REGION = "us";
    // Should resolve fast and synchronously-ish — definitely no 5-min wait and
    // no network (oauthLogin is not invoked from resolveClientFromEnv anymore).
    const { client, authState } = await resolveClientFromEnv(logger as any);
    expect(authState).toBe("pending");
    expect(client).toBeInstanceOf(LeadbayClient);
    expect(client.isAuthenticated).toBe(false);
    expect(client.region).toBe("us");
  });

  it("honors a pinned LEADBAY_BASE_URL on the pending client", async () => {
    process.env.LEADBAY_OAUTH_BOOTSTRAP = "1";
    process.env.LEADBAY_REGION = "fr";
    process.env.LEADBAY_BASE_URL = "https://staging.api.leadbay.app";
    const { client, authState } = await resolveClientFromEnv(logger as any);
    expect(authState).toBe("pending");
    expect(client.baseUrl).toBe("https://staging.api.leadbay.app");
  });
});
