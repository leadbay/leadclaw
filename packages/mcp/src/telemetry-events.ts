// Single source of truth for PostHog event names + their shapes. Imported
// by telemetry.ts (capture sites) and telemetry.test.ts (assertion targets)
// so a rename is one edit, not a search-and-replace.

export const EV_TOOL_CALL = "mcp tool called";
export const EV_QUOTA_HIT = "mcp quota hit";
export const EV_TOPUP_LINK = "mcp topup link created";

export type ToolCallFormat = "json" | "markdown" | "error-envelope";

export interface ToolCallProps {
  tool: string;
  ok: boolean;
  duration_ms: number;
  format: ToolCallFormat;
  bytes: number;
  error_code?: string;
}

export interface QuotaHitProps {
  tool: string;
  retry_after_s?: number;
  endpoint?: string;
}

export interface TopupLinkProps {
  tool: string;
}

export interface ExceptionCtx {
  tool: string;
}
