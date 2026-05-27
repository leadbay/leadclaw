import { describe, it, expect } from "vitest";
import { buildCodexConfigBlock, buildShellExportBlock } from "../../src/bin.js";

describe("codex install helpers — module loads", () => {
  it("buildCodexConfigBlock is a function", () => {
    expect(typeof buildCodexConfigBlock).toBe("function");
  });
  it("buildShellExportBlock is a function", () => {
    expect(typeof buildShellExportBlock).toBe("function");
  });
});
