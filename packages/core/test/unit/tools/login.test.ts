/**
 * Tests for the login tool (protocol-agnostic Tool shape).
 *
 * v0.2.0 (post-autoplan): login uses resolveRegion() which tries us first,
 * then fr. The mock harness matches by method+path, so a single login script
 * matches the first attempt; if you want to test the FR-fallback path,
 * register two consecutive scripts (the first one is consumed by us, the
 * second by fr).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  createLogger,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { login } from "../../../src/tools/login.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_login — password unescape", () => {
  const unescapeCases: Array<[string, string, string]> = [
    ["backslash-escaped special char is stripped", "Pass\\!word", "Pass!word"],
    [
      "double backslash collapses to single (known behavior)",
      "x\\\\y",
      "x\\y",
    ],
    [
      "trailing lone backslash is preserved (regex needs a follow char)",
      "pass\\",
      "pass\\",
    ],
  ];

  it.each(unescapeCases)(
    "%s: %s → %s",
    async (_label, input, expected) => {
      const { requests } = mockHttp([
        {
          method: "POST",
          path: "/1.6/auth/login",
          status: 200,
          body: { token: "u.new-token", verified: true },
        },
        { method: "GET", path: /\/1\.6\/users\/me/, status: 404, body: {} },
      ]);
      const client = new LeadbayClient(BASE, undefined, "us");
      const { logger } = createLogger();

      await login.execute(
        client,
        { email: "a@b.com", password: input },
        { logger }
      );

      const loginReq = requests.find((r) => r.path === "/1.6/auth/login");
      expect(loginReq).toBeDefined();
      const payload = JSON.parse(loginReq!.body!);
      expect(payload.password).toBe(expected);
    }
  );
});

describe("leadbay_login — region auto-detect + status handling", () => {
  it("200 on US first try → success, region=us", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 200,
        body: { token: "u.abc123", verified: true },
      },
      { method: "GET", path: /users\/me/, status: 404, body: {} },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "secret" },
      { logger }
    );

    expect(result.success).toBe(true);
    expect(result.region).toBe("us");
    expect(result.verified).toBe(true);
    expect(result.message).toMatch(/Logged in to Leadbay/i);
    expect(client.isAuthenticated).toBe(true);
  });

  it("401 on US, 200 on FR → success, region=fr (auto-fallback)", async () => {
    mockHttp([
      // First attempt: us → 401
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 401,
        body: { message: "wrong region" },
      },
      // Second attempt: fr → 200
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 200,
        body: { token: "u.fr-token", verified: true },
      },
      { method: "GET", path: /users\/me/, status: 404, body: {} },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "secret" },
      { logger }
    );

    expect(result.success).toBe(true);
    expect(result.region).toBe("fr");
    expect(client.isAuthenticated).toBe(true);
    expect(client.region).toBe("fr");
  });

  it("401 on both regions returns LOGIN_FAILED", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 401,
        body: { message: "bad credentials" },
      },
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 401,
        body: { message: "bad credentials" },
      },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "wrong" },
      { logger }
    );

    expect(result).toMatchObject({
      error: true,
      code: "LOGIN_FAILED",
    });
    expect(result.message).toMatch(/both regions/i);
    expect(client.isAuthenticated).toBe(false);
  });

  it("network error on both regions returns LOGIN_FAILED", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 0,
        error: new Error("ECONNREFUSED"),
      },
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 0,
        error: new Error("ECONNREFUSED"),
      },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "x" },
      { logger }
    );

    expect(result.error).toBe(true);
    expect(result.code).toBe("LOGIN_FAILED");
  });

  it("prefetchOrgData rejection is swallowed (fire-and-forget)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 200,
        body: { token: "u.abc", verified: true },
      },
      { method: "GET", path: /users\/me/, status: 500, body: {} },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger } = createLogger();

    const result: any = await login.execute(
      client,
      { email: "a@b.com", password: "x" },
      { logger }
    );

    expect(result.success).toBe(true);
    await new Promise((r) => setImmediate(r));
  });

  it("logger.info / logger.error are invoked with descriptive messages on failure", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 401,
        body: { message: "bad" },
      },
      {
        method: "POST",
        path: "/1.6/auth/login",
        status: 401,
        body: { message: "bad" },
      },
    ]);
    const client = new LeadbayClient(BASE, undefined, "us");
    const { logger, logs } = createLogger();

    await login.execute(
      client,
      { email: "a@b.com", password: "wrong" },
      { logger }
    );

    expect(
      logs.some((l) => l.level === "info" && /startRegion/.test(l.msg))
    ).toBe(true);
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });
});
