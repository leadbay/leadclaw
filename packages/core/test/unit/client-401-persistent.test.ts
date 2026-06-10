import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// When a 401 survives the automatic retry, it is a Leadbay-side problem (tokens
// don't time out). The surfaced message must blame Leadbay's side and tell the
// user to try again later — short, and never "re-login".
describe("LeadbayClient — persistent 401 blames Leadbay-side, stays short", () => {
  it("message attributes the failure to Leadbay's side, not the user's login", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
    ]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      const hint = err.hint.toLowerCase();
      expect(hint).toContain("leadbay's side");
      expect(hint).toContain("try again");
      // Stays concise (no multi-paragraph lecture, no login instructions).
      expect(err.hint.length).toBeLessThan(220);
      // No re-login instruction (mentioning "your login is fine" is allowed).
      expect(hint).not.toContain("mcp login");
      expect(hint).not.toContain("re-authenticate");
    }
  });
});
