import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Because Leadbay tokens never time out, a PERSISTENT 401 is most likely a
// Leadbay-side problem, not a stale login — re-authenticating won't fix it.
// The 401 hint must say so, and must NOT push re-login as the default remedy.
describe("LeadbayClient — persistent 401 points at Leadbay-side, not re-login", () => {
  it("hint frames persistent 401 as likely a Leadbay-side issue", async () => {
    mockHttp([{ method: "GET", path: "/1.5/lenses", status: 401, body: {} }]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      const hint = err.hint.toLowerCase();
      // Says re-auth likely won't help on persistence.
      expect(hint).toContain("persist");
      expect(hint).toMatch(/won't help|wont help/);
      // Attributes persistent failure to Leadbay's side.
      expect(hint).toContain("leadbay's side");
      // Re-login is gated as the explicit-logout exception, not the default.
      expect(hint).toContain("exception");
    }
  });
});
