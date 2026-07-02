/**
 * Regression tests for OAuth-broken-on-Windows, part 2 (issue #3839).
 *
 * The #3801 fix quoted the URL so `cmd start` wouldn't truncate it at `&`. But
 * `cmd` ALWAYS spawns (fixed path), and its `start` builtin does the real
 * browser hand-off — which can silently no-op (no default-browser protocol
 * association / a locked-down shell) while spawn still reports success. So the
 * browser never opened and the fallback never fired.
 *
 * Fix pinned here: two shell-free second-chance launchers live in a SEPARATE
 * list, windowsFallbackCandidates(), which openInBrowser tries only after every
 * `cmd start` candidate has failed the exit-wait (see the exit-wait test):
 *   1. rundll32 url.dll,FileProtocolHandler <url>   — Explorer's ShellExecute
 *      path, no command interpreter (no `&` hazard, raw URL), honest exit code.
 *   2. powershell -NoProfile -NonInteractive -Command Start-Process <url>
 *      — heavy last resort with a reliable exit code.
 * They're kept OUT of browserOpenCandidates() so the #3801-pinned "every win32
 * candidate ends in a quoted URL" invariant stays intact.
 *
 * New file — the existing oauth-browser-open.test.ts / -win32-url.test.ts pins
 * are left untouched.
 */
import { describe, it, expect, afterEach } from "vitest";
import { browserOpenCandidates, windowsFallbackCandidates } from "../../src/oauth.js";

const AUTH_URL =
  "https://leadbay.app/oauth/authorize?client_id=99" +
  "&code_challenge=abc123&code_challenge_method=S256&state=xyz789" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A51789%2Fcallback";

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}
afterEach(() => setPlatform(realPlatform));

describe("browserOpenCandidates — win32 head is still just the #3801 cmd pair", () => {
  it("returns exactly the two `cmd start` candidates (no shell-free launchers mixed in)", () => {
    setPlatform("win32");
    const savedRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    try {
      const cands = browserOpenCandidates(AUTH_URL);
      expect(cands).toHaveLength(2);
      // Every candidate ends in the double-quoted URL — the invariant the
      // #3801 regression test loops over. Appending raw-URL launchers HERE
      // would break it; that's why they live in windowsFallbackCandidates.
      for (const c of cands) {
        expect(c.args[c.args.length - 1]).toBe(`"${AUTH_URL}"`);
      }
    } finally {
      if (savedRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = savedRoot;
    }
  });
});

describe("windowsFallbackCandidates — shell-free second-chance launchers (#3839)", () => {
  it("returns rundll32 then powershell, both with the RAW (unquoted) URL", () => {
    const savedRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    try {
      const cands = windowsFallbackCandidates(AUTH_URL);
      expect(cands).toHaveLength(2);

      // 1: rundll32 with the raw URL as one literal arg — no shell, so no
      // quoting dance and no `&`-truncation hazard.
      expect(cands[0]).toEqual({
        cmd: "C:\\Windows\\System32\\rundll32.exe",
        args: ["url.dll,FileProtocolHandler", AUTH_URL],
      });
      expect(cands[0].args[cands[0].args.length - 1]).toBe(AUTH_URL);
      expect(cands[0].args[cands[0].args.length - 1]).not.toMatch(/^".*"$/);

      // 2: PowerShell Start-Process, last resort, also with the raw URL.
      expect(cands[1].cmd).toBe(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      );
      expect(cands[1].args).toContain("Start-Process");
      expect(cands[1].args).toContain("-NoProfile");
      expect(cands[1].args).toContain("-NonInteractive");
      expect(cands[1].args).toContain(AUTH_URL);
    } finally {
      if (savedRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = savedRoot;
    }
  });

  it("resolves both launchers under %windir% when SystemRoot is unset", () => {
    const savedRoot = process.env.SystemRoot;
    const savedWindir = process.env.windir;
    delete process.env.SystemRoot;
    process.env.windir = "D:\\WINNT";
    try {
      const cands = windowsFallbackCandidates(AUTH_URL);
      expect(cands[0].cmd).toBe("D:\\WINNT\\System32\\rundll32.exe");
      expect(cands[1].cmd).toBe(
        "D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      );
    } finally {
      if (savedRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = savedRoot;
      if (savedWindir === undefined) delete process.env.windir;
      else process.env.windir = savedWindir;
    }
  });
});
