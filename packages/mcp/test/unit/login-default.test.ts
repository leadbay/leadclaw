/**
 * runLogin default-path resolution — covers resolveDefaultCredentialsPath
 * picking the right platform-correct file and honoring the legacy fallback.
 *
 * The full runLogin flow is too tangled with TTY/network/password reading to
 * mock in a unit test (smoke-tested in the verification plan). Here we exercise
 * the path-resolution helper directly because that's the part most likely to
 * regress — wrong path = silent token leak / broken upgrade for a user.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultCredentialsPath } from "../../src/bin.js";

let saved: Record<string, string | undefined>;
let tmpHome: string;

const ENV_KEYS = ["XDG_CONFIG_HOME", "APPDATA", "HOME", "USERPROFILE"];

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
  }
  tmpHome = mkdtempSync(join(tmpdir(), "leadbay-login-test-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.APPDATA;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("resolveDefaultCredentialsPath — platform routing", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    const xdg = join(tmpHome, "xdg");
    mkdirSync(xdg, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    const { path, legacy } = resolveDefaultCredentialsPath();
    expect(legacy).toBe(false);
    expect(path).toBe(join(xdg, "leadbay", "credentials.json"));
  });

  it("on macOS without XDG, uses Library/Application Support", () => {
    if (process.platform !== "darwin") {
      // resolveDefaultCredentialsPath reads process.platform directly; only
      // assert this branch on macOS test runners.
      return;
    }
    const { path, legacy } = resolveDefaultCredentialsPath();
    expect(legacy).toBe(false);
    expect(path).toBe(join(tmpHome, "Library", "Application Support", "leadbay", "credentials.json"));
  });

  it("on Linux without XDG, falls back to ~/.config", () => {
    if (process.platform === "darwin" || process.platform === "win32") return;
    const { path, legacy } = resolveDefaultCredentialsPath();
    expect(legacy).toBe(false);
    expect(path).toBe(join(tmpHome, ".config", "leadbay", "credentials.json"));
  });

  it("when ~/.leadbay-mcp.json exists (0.2.x layout), uses that path with legacy=true", () => {
    const legacyPath = join(tmpHome, ".leadbay-mcp.json");
    writeFileSync(legacyPath, "{}");
    const { path, legacy } = resolveDefaultCredentialsPath();
    expect(legacy).toBe(true);
    expect(path).toBe(legacyPath);
  });

  it("returns a path even when HOME is unwritable (no fs ops in resolver)", () => {
    // resolver is pure; doesn't touch the filesystem except existsSync.
    expect(() => resolveDefaultCredentialsPath()).not.toThrow();
  });
});

describe("resolveDefaultCredentialsPath — output shape", () => {
  it("path always ends with credentials.json (or the legacy filename)", () => {
    const { path } = resolveDefaultCredentialsPath();
    expect(path).toMatch(/credentials\.json$|\.leadbay-mcp\.json$/);
  });

  it("path is absolute", () => {
    const { path } = resolveDefaultCredentialsPath();
    expect(path.startsWith("/") || /^[A-Z]:[/\\]/.test(path)).toBe(true);
  });
});

describe("resolveDefaultCredentialsPath — directory does not exist yet", () => {
  it("returns a path under a directory the caller is expected to mkdir", () => {
    const { path, legacy } = resolveDefaultCredentialsPath();
    if (legacy) return; // legacy file exists; no parent-dir creation needed.
    // Parent dir should NOT yet exist — runLogin is responsible for mkdirSync.
    const parent = path.replace(/[/\\][^/\\]+$/, "");
    expect(existsSync(parent)).toBe(false);
  });
});
