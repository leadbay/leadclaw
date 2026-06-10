import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Leadbay OAuth tokens never expire on a timer (they live until explicit
// logout / server revocation). A 401 is therefore usually transient and must
// NOT be reported to the agent as "your token expired, re-login" — that copy
// made agents hallucinate a dead session. These tests lock in the corrected
// messaging while keeping the AUTH_EXPIRED code for backward compatibility.
describe("LeadbayClient — 401 is not framed as token expiry", () => {
  it("401 still maps to the AUTH_EXPIRED code (backward compat)", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 401, body: {} }]);
    await expect(newClient().request("GET", "/lenses")).rejects.toMatchObject({
      error: true,
      code: "AUTH_EXPIRED",
    });
  });

  it("401 message/hint do NOT assert the token expired or is invalid", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 401, body: {} }]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      const text = `${err.message} ${err.hint}`.toLowerCase();
      // Must NOT assert the token itself expired or is dead. (The phrase
      // "tokens don't expire" legitimately contains "expire", so we match the
      // specific misleading claims, not the bare substring.)
      expect(text).not.toContain("token expired");
      expect(text).not.toContain("no longer valid");
      expect(text).not.toContain("session expired");
      // Steers toward retry, and explicitly states tokens don't expire on a timer.
      expect(err.hint.toLowerCase()).toContain("retry");
      expect(err.hint.toLowerCase()).toContain("don't expire");
    }
  });

  it("401 hint keeps a re-auth escape hatch for persistent failures only", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 401, body: {} }]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      // The login path is still mentioned, but gated on persistence.
      expect(err.hint).toContain("login");
      expect(err.hint.toLowerCase()).toContain("persist");
    }
  });
});
