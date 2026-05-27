# Codex Install Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `leadbay-mcp install` to detect and configure OpenAI Codex CLI alongside Claude Code, Claude Desktop, and Cursor.

**Architecture:** All changes land in `packages/mcp/src/bin.ts`. Two new exported functions (`buildCodexConfigBlock`, `buildShellExportBlock`) keep pure logic unit-testable without filesystem side effects. Two new async functions (`installInCodexConfig`, `appendShellExports`) handle the actual writes. `detectClients()` gains a Codex branch. `runInstall()` dispatches to the new functions when `c.id === "codex"`.

**Tech Stack:** Node.js, TypeScript, no new dependencies (TOML block written as a string, no parser needed).

---

## File map

| File | Action |
|---|---|
| `packages/mcp/src/bin.ts` | Modify — all implementation |
| `packages/mcp/test/unit/install-codex.test.ts` | Create — unit tests for new pure functions |

---

### Task 1: Extend `DetectedClient` type and detect Codex in `detectClients()`

**Files:**
- Modify: `packages/mcp/src/bin.ts:744` (DetectedClient interface)
- Modify: `packages/mcp/src/bin.ts:782` (detectClients function)

- [ ] **Step 1: Write the failing test**

Create `packages/mcp/test/unit/install-codex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCodexConfigBlock, buildShellExportBlock } from "../../src/bin.js";

// Placeholder — real tests added in Task 2. This file must exist for vitest
// to pick it up. We start with a trivial sanity check.
describe("codex install helpers — module loads", () => {
  it("buildCodexConfigBlock is a function", () => {
    expect(typeof buildCodexConfigBlock).toBe("function");
  });
  it("buildShellExportBlock is a function", () => {
    expect(typeof buildShellExportBlock).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/mcp && pnpm test test/unit/install-codex.test.ts
```

Expected: FAIL — `buildCodexConfigBlock` not exported from `bin.js`.

- [ ] **Step 3: Add `"codex"` to `DetectedClient.id` union**

In `packages/mcp/src/bin.ts`, find line ~744:
```typescript
interface DetectedClient {
  id: "claude-code" | "claude-desktop" | "cursor";
```
Change to:
```typescript
interface DetectedClient {
  id: "claude-code" | "claude-desktop" | "cursor" | "codex";
```

- [ ] **Step 4: Add Codex detection at the end of `detectClients()`**

Find the end of `detectClients()` (just before `return out;`, around line ~880). Add:

```typescript
  // Codex: detect via `which codex` / `where codex`, confirm ~/.codex dir exists.
  const codexBin = await new Promise<string | null>((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = require_("node:child_process").spawn(cmd, ["codex"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (c: Buffer) => (buf += c.toString()));
    child.on("close", (code: number) =>
      resolve(code === 0 ? buf.split(/\r?\n/)[0] : null)
    );
  });
  if (codexBin) {
    const codexConfigPath =
      process.platform === "win32"
        ? `${process.env.USERPROFILE ?? home}\\.codex\\config.toml`
        : `${home}/.codex/config.toml`;
    out.push({ id: "codex", label: "Codex", detail: codexConfigPath });
  }
```

- [ ] **Step 5: Export two pure builder functions (stubs for now)**

Just after the `detectClients` closing brace, add:

```typescript
export function buildCodexConfigBlock(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean,
  version: string
): string {
  const envVars = ["LEADBAY_TOKEN", "LEADBAY_REGION", "LEADBAY_TELEMETRY_ENABLED"];
  if (!includeWrite) envVars.push("LEADBAY_MCP_WRITE");
  const envVarsToml = envVars.map((v) => `"${v}"`).join(", ");
  return (
    `[mcp_servers.leadbay]\n` +
    `command = "npx"\n` +
    `args = ["-y", "@leadbay/mcp@${version}"]\n` +
    `env_vars = [${envVarsToml}]\n`
  );
}

export function buildShellExportBlock(token: string, region: "us" | "fr"): string {
  return (
    `\n# Added by leadbay-mcp install\n` +
    `export LEADBAY_TOKEN="${token}"\n` +
    `export LEADBAY_REGION="${region}"\n`
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/mcp && pnpm test test/unit/install-codex.test.ts
```

Expected: PASS.

- [ ] **Step 7: Typecheck**

```bash
cd packages/mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src/bin.ts packages/mcp/test/unit/install-codex.test.ts
git commit -m "feat(install): detect Codex client + export pure config builder fns"
```

---

### Task 2: Unit-test `buildCodexConfigBlock` and `buildShellExportBlock`

**Files:**
- Modify: `packages/mcp/test/unit/install-codex.test.ts`

- [ ] **Step 1: Replace stub tests with real ones**

Replace the full content of `packages/mcp/test/unit/install-codex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCodexConfigBlock, buildShellExportBlock } from "../../src/bin.js";

describe("buildCodexConfigBlock", () => {
  it("emits [mcp_servers.leadbay] header", () => {
    const block = buildCodexConfigBlock("tok", "us", true, true, "0.14");
    expect(block).toContain("[mcp_servers.leadbay]");
  });

  it("uses npx command with correct version pin", () => {
    const block = buildCodexConfigBlock("tok", "us", true, true, "0.14");
    expect(block).toContain('command = "npx"');
    expect(block).toContain('"@leadbay/mcp@0.14"');
  });

  it("always forwards LEADBAY_TOKEN, LEADBAY_REGION, LEADBAY_TELEMETRY_ENABLED", () => {
    const block = buildCodexConfigBlock("tok", "us", true, true, "0.14");
    expect(block).toContain('"LEADBAY_TOKEN"');
    expect(block).toContain('"LEADBAY_REGION"');
    expect(block).toContain('"LEADBAY_TELEMETRY_ENABLED"');
  });

  it("includeWrite=true does NOT include LEADBAY_MCP_WRITE", () => {
    const block = buildCodexConfigBlock("tok", "us", true, true, "0.14");
    expect(block).not.toContain("LEADBAY_MCP_WRITE");
  });

  it("includeWrite=false adds LEADBAY_MCP_WRITE to env_vars", () => {
    const block = buildCodexConfigBlock("tok", "us", false, true, "0.14");
    expect(block).toContain('"LEADBAY_MCP_WRITE"');
  });
});

describe("buildShellExportBlock", () => {
  it("exports LEADBAY_TOKEN with value", () => {
    const block = buildShellExportBlock("my-token", "us");
    expect(block).toContain('export LEADBAY_TOKEN="my-token"');
  });

  it("exports LEADBAY_REGION with value", () => {
    const block = buildShellExportBlock("my-token", "fr");
    expect(block).toContain('export LEADBAY_REGION="fr"');
  });

  it("includes attribution comment", () => {
    const block = buildShellExportBlock("tok", "us");
    expect(block).toContain("# Added by leadbay-mcp install");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/mcp && pnpm test test/unit/install-codex.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/test/unit/install-codex.test.ts
git commit -m "test(install): unit tests for buildCodexConfigBlock and buildShellExportBlock"
```

---

### Task 3: Implement `installInCodexConfig()`

**Files:**
- Modify: `packages/mcp/src/bin.ts` — add after `installInJsonConfig`

- [ ] **Step 1: Add the function**

Add the following after the closing brace of `installInJsonConfig` (around line ~1028):

```typescript
async function installInCodexConfig(
  configPath: string,
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean
): Promise<{ ok: boolean; message: string }> {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");

    let existing = "";
    if (existsSync(configPath)) {
      existing = readFileSync(configPath, "utf8");
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
    }

    // Strip any existing [mcp_servers.leadbay] block so we can replace it cleanly.
    // Matches the section header and all lines until the next [section] or EOF.
    const stripped = existing.replace(
      /\[mcp_servers\.leadbay\][^\[]*/gs,
      ""
    ).trimEnd();

    const block = buildCodexConfigBlock(token, region, includeWrite, telemetryEnabled, VERSION);
    const updated = (stripped ? stripped + "\n\n" : "") + block;

    const tmp = configPath + ".tmp";
    writeFileSync(tmp, updated, "utf8");
    const { renameSync } = await import("node:fs");
    renameSync(tmp, configPath);

    return { ok: true, message: `registered (${configPath})` };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/bin.ts
git commit -m "feat(install): implement installInCodexConfig() TOML writer"
```

---

### Task 4: Implement `appendShellExports()`

**Files:**
- Modify: `packages/mcp/src/bin.ts` — add after `installInCodexConfig`

- [ ] **Step 1: Add the function**

```typescript
async function appendShellExports(
  token: string,
  region: "us" | "fr"
): Promise<string[]> {
  const os = await import("node:os");
  const { existsSync, readFileSync, appendFileSync } = await import("node:fs");

  if (process.platform === "win32") {
    // On Windows, use setx to persist user-level env vars.
    const cp = await import("node:child_process");
    const run = (k: string, v: string) =>
      new Promise<void>((resolve) => {
        cp.spawn("setx", [k, v], { stdio: "ignore" }).on("close", () => resolve());
      });
    await run("LEADBAY_TOKEN", token);
    await run("LEADBAY_REGION", region);
    return ["setx (user env vars written to registry)"];
  }

  const home = os.homedir();
  const rcFiles = [`${home}/.zshrc`, `${home}/.bashrc`];
  const fallback = `${home}/.profile`;

  const block = buildShellExportBlock(token, region);
  const written: string[] = [];

  let wroteAny = false;
  for (const rc of rcFiles) {
    if (!existsSync(rc)) continue;
    const contents = readFileSync(rc, "utf8");
    if (contents.includes("LEADBAY_TOKEN=")) {
      // Already exported — update value by replacing existing line.
      const updated = contents.replace(
        /^export LEADBAY_TOKEN=.*$/m,
        `export LEADBAY_TOKEN="${token}"`
      ).replace(
        /^export LEADBAY_REGION=.*$/m,
        `export LEADBAY_REGION="${region}"`
      );
      // Only write if something actually changed.
      if (updated !== contents) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(rc, updated, "utf8");
        written.push(`${rc} (updated)`);
      } else {
        written.push(`${rc} (already up-to-date)`);
      }
      wroteAny = true;
      continue;
    }
    appendFileSync(rc, block, "utf8");
    written.push(rc);
    wroteAny = true;
  }

  if (!wroteAny) {
    // Neither .zshrc nor .bashrc exist — fall back to .profile.
    if (!existsSync(fallback)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(fallback, block, "utf8");
    } else {
      const contents = readFileSync(fallback, "utf8");
      if (!contents.includes("LEADBAY_TOKEN=")) {
        appendFileSync(fallback, block, "utf8");
      }
    }
    written.push(fallback);
  }

  return written;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/bin.ts
git commit -m "feat(install): implement appendShellExports() for Codex env var persistence"
```

---

### Task 5: Wire Codex into `runInstall()`

**Files:**
- Modify: `packages/mcp/src/bin.ts` — `runInstall` loop (~line 1220)

- [ ] **Step 1: Add the Codex branch to the dispatch loop**

Find this block inside `runInstall`:

```typescript
    let res: { ok: boolean; message: string };
    if (c.id === "claude-code") {
      res = await installInClaudeCode(token, region, includeWrite, telemetryEnabled);
    } else {
      // claude-desktop and cursor both use the same JSON shape.
      const path = c.detail.split(" ")[0];
      res = await installInJsonConfig(path, token, region, includeWrite, telemetryEnabled);
    }
```

Replace with:

```typescript
    let res: { ok: boolean; message: string };
    if (c.id === "claude-code") {
      res = await installInClaudeCode(token, region, includeWrite, telemetryEnabled);
    } else if (c.id === "codex") {
      res = await installInCodexConfig(c.detail, token, region, includeWrite, telemetryEnabled);
      if (res.ok) {
        const exported = await appendShellExports(token, region);
        if (exported.length > 0) {
          process.stderr.write(
            `  Shell exports written to: ${exported.join(", ")}\n` +
            `  Run \`source ${exported[0]}\` or restart your terminal before launching Codex.\n`
          );
        }
      }
    } else {
      // claude-desktop and cursor both use the same JSON shape.
      const path = c.detail.split(" ")[0];
      res = await installInJsonConfig(path, token, region, includeWrite, telemetryEnabled);
    }
```

- [ ] **Step 2: Run full test suite**

```bash
cd packages/mcp && pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Typecheck**

```bash
cd packages/mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/bin.ts
git commit -m "feat(install): wire Codex into runInstall dispatch loop"
```

---

### Task 6: Run full workspace checks and create draft PR

**Files:** none

- [ ] **Step 1: Run workspace-wide tests and typecheck**

```bash
pnpm -r test && pnpm -r typecheck
```

Expected: green across all packages.

- [ ] **Step 2: Push branch**

```bash
git push -u origin ArtyETH06/https-github.com-leadbay-product-issues-3651
```

- [ ] **Step 3: Create draft PR**

```bash
gh pr create --draft \
  --title "feat(install): add Codex CLI support to leadbay-mcp install" \
  --body "$(cat <<'EOF'
## Summary

- Detects OpenAI Codex CLI via `which codex` on all platforms (Linux, macOS, Windows)
- Writes `~/.codex/config.toml` with stdio `npx @leadbay/mcp` block and `env_vars` forwarding
- Appends `export LEADBAY_TOKEN` / `export LEADBAY_REGION` to `~/.zshrc`, `~/.bashrc`, or `~/.profile` (Windows: `setx`)
- Codex appears in the install summary alongside Claude Code, Claude Desktop, Cursor

Closes https://github.com/leadbay/product/issues/3651

## Test plan

- [ ] `pnpm -r test` green
- [ ] `pnpm -r typecheck` green
- [ ] `buildCodexConfigBlock` unit tests cover version pin, env_vars, write flag
- [ ] `buildShellExportBlock` unit tests cover token, region, idempotency guard
- [ ] Manual: `npx -y @leadbay/mcp install --email you@example.com --region us` on Linux with Codex installed — verify config.toml written and shell rc updated
EOF
)" \
  --assignee ArtyETH06 \
  --label "feature" \
  --project "Product"
```

- [ ] **Step 4: Verify PR metadata**

```bash
gh pr view --json number,title,assignees,labels,projectItems | cat
```

Expected: assignee=ArtyETH06, label=feature, project=Product.
