// Single source of truth for PostHog event names + their shapes. Imported
// by telemetry.ts (capture sites) and telemetry.test.ts (assertion targets)
// so a rename is one edit, not a search-and-replace.

export const EV_TOOL_CALL = "mcp tool called";
export const EV_QUOTA_HIT = "mcp quota hit";
export const EV_TOPUP_LINK = "mcp topup link created";
export const EV_STARTUP = "mcp startup";

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

// auth_state buckets startups by whether resolveClientFromEnv produced a
// real client ("ok") or a broken stub. Lets us bucket "Server
// disconnected" reports without reading individual users' logs.
export type StartupAuthState = "ok" | "missing" | "expired" | "probe_failed";

export interface StartupProps {
  auth_state: StartupAuthState;
  region: string;
}
