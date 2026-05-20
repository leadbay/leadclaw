// Public ingest credentials baked into the published @leadbay/mcp tarball.
// Same posture the frontend uses (VITE_POSTHOG_TOKEN / VITE_SENTRY_DSN
// embedded in the Vite bundle): PostHog public project tokens and Sentry
// DSNs are designed to be embedded in client code.
//
// The PostHog token matches the frontend's VITE_POSTHOG_TOKEN (project id
// 23333, EU instance) so web-app and MCP events consolidate on the same
// `distinctId = email`. The Sentry DSN is MCP-specific so server-side
// throws don't pollute the web app's issues dashboard.
//
// Override with LEADBAY_POSTHOG_KEY / LEADBAY_SENTRY_DSN; opt-out entirely
// with LEADBAY_TELEMETRY_DISABLED=1.

export const EMBEDDED_POSTHOG_KEY =
  "phc_N9SnA7OULuAlXReQJZ0Y3rPI4eC0mJLpMRbzgqamhHR";
export const EMBEDDED_POSTHOG_HOST = "https://eu.i.posthog.com";
export const EMBEDDED_SENTRY_DSN =
  "https://301f1c433433b76132956ed5415bea19@o4505874436849664.ingest.us.sentry.io/4511419984248832";
