/**
 * Host-native widget routing instruction.
 *
 * Spliced into `buildServerInstructions` so the agent knows that
 * Claude / ChatGPT chat hosts expose their own first-party widgets
 * for the most common output shapes — and that those, not our own
 * iframe-style widgets, are the right surface. (The iframe-style
 * widgets were a 0.10.0-dev.x experiment that didn't ship — see
 * /CLAUDE.md "MCP Apps widget pipeline — DEPRECATED".)
 *
 * The paragraph self-conditions ("when your host exposes…") so hosts
 * that don't have a given widget skip silently; the agent falls back
 * to the canonical RENDERING block (markdown table / card / chips)
 * the per-tool description specifies.
 */
export const BUILTIN_WIDGETS_PARAGRAPH =
  "Prefer host-native widgets over inline markdown when the data shape fits. " +
  "Three to know: (1) `places_map_display_v0` — for ≥2 locations / map / travel intent. " +
  "Pass `{name, address, latitude, longitude, notes}` per location; the host enriches via Google Places. " +
  "(2) `message_compose_v1` — for any outreach draft (email / message / call opener). " +
  "Pass 2–3 strategic variants with goal-oriented labels (\"Push for alignment\", \"Reference M&A signal\") — NOT tone labels. " +
  "(3) `ask_user_input_v0` — for the NEXT STEPS questions every Leadbay tool emits. " +
  "Pass `single_select` with 2–4 mutually-exclusive options from the tool's NEXT STEPS table. " +
  "When the host doesn't expose the named widget, fall back to the per-tool markdown RENDERING block. " +
  "The directive is host-conditional; the fallback is automatic.";
