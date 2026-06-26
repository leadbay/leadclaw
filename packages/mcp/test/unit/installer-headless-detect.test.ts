/**
 * Tests for the headless / no-browser detection that fixes the Claude Cowork
 * installer hang (#3805). The guided GUI installer must short-circuit to a
 * copy-paste hosted-MCP command when no browser can ever open, but a real
 * desktop run must still get the GUI — so detection is deliberately
 * conservative.
 *
 * Pins:
 *   - `--no-open` and `CI` always read as headless (any platform).
 *   - Linux with no DISPLAY/WAYLAND_DISPLAY AND no TTY reads as headless.
 *   - Linux with a display (normal desktop) does NOT — even without a TTY.
 *   - macOS / Windows are never auto-classified headless.
 *   - printHostedMcpHelp emits the hosted URL + both fallback commands.
 *
 * New file (existing install-shared / installer tests are left untouched).
 */
import { describe, it, expect } from "vitest";
import { detectNoBrowserEnv, printHostedMcpHelp, HOSTED_MCP_URL } from "../../installer/install-shared.js";

describe("detectNoBrowserEnv — conservative headless detection", () => {
  it("--no-open in argv is headless on any platform", () => {
    const r = detectNoBrowserEnv(["--no-open"], {}, "darwin", true);
    expect(r.headless).toBe(true);
    expect(r.reason).toMatch(/no-open/);
  });

  it("CI env is headless", () => {
    const r = detectNoBrowserEnv([], { CI: "1" }, "linux", false);
    expect(r.headless).toBe(true);
    expect(r.reason).toMatch(/CI/);
  });

  it("Linux with no DISPLAY/WAYLAND and no TTY is headless (the Cowork case)", () => {
    const r = detectNoBrowserEnv([], {}, "linux", false);
    expect(r.headless).toBe(true);
    expect(r.reason).toMatch(/Linux/);
  });

  it("Linux with a DISPLAY is NOT headless even without a TTY (real desktop)", () => {
    const r = detectNoBrowserEnv([], { DISPLAY: ":0" }, "linux", false);
    expect(r.headless).toBe(false);
  });

  it("Linux with WAYLAND_DISPLAY is NOT headless", () => {
    const r = detectNoBrowserEnv([], { WAYLAND_DISPLAY: "wayland-0" }, "linux", false);
    expect(r.headless).toBe(false);
  });

  it("Linux with a TTY (no display) is NOT auto-classified headless", () => {
    // A terminal user without X can still complete the terminal OAuth flow; we
    // only short-circuit when there's neither a display nor an interactive TTY.
    const r = detectNoBrowserEnv([], {}, "linux", true);
    expect(r.headless).toBe(false);
  });

  it("macOS is never auto-classified headless (window server assumed)", () => {
    expect(detectNoBrowserEnv([], {}, "darwin", false).headless).toBe(false);
  });

  it("Windows is never auto-classified headless", () => {
    expect(detectNoBrowserEnv([], {}, "win32", false).headless).toBe(false);
  });
});

describe("printHostedMcpHelp — actionable fallback block", () => {
  it("emits the hosted MCP URL and both fallback commands", () => {
    let out = "";
    printHostedMcpHelp((s) => { out += s; });
    expect(out).toContain(HOSTED_MCP_URL);
    expect(out).toContain("claude mcp add --transport http leadbay");
    expect(out).toContain("install --oauth");
  });
});
