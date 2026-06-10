import type { WebFetchSignalsSection } from "../types.js";

// Shared web_fetch.content reshaping. The backend keys web-research signals
// by emoji-prefixed section labels (e.g. "🏢 company profile", "📈 business
// signals"); each value is an array of WebFetchEntry. Composites that surface
// signals to the agent reshape this dynamic dict into an ordered array.
//
// Used by leadbay_research_lead_by_id (single lead) and
// leadbay_scan_portfolio_signals (bulk read).

// Stable section ordering: profile → signals → clues → others (alphabetical).
export const SECTION_PRIORITY = ["profile", "signals", "clues"];

// Map an emoji-prefixed section label like "🏢 company profile" to
// {emoji: "🏢", label: "company profile"}. If no emoji prefix, label stays
// as-is and emoji is null.
export function splitEmojiSection(key: string): {
  emoji: string | null;
  label: string;
} {
  // Match a leading non-letter/non-digit run (typically emoji) followed by space.
  const m = key.match(/^([^\p{L}\p{N}\s]+)\s+(.+)$/u);
  if (m) return { emoji: m[1], label: m[2] };
  return { emoji: null, label: key };
}

export function reshapeWebFetchContent(
  content: Record<string, unknown> | null
): WebFetchSignalsSection[] {
  if (!content) return [];
  const sections: WebFetchSignalsSection[] = [];
  for (const [key, val] of Object.entries(content)) {
    if (!Array.isArray(val)) continue;
    const { emoji, label } = splitEmojiSection(key);
    sections.push({
      section_label: label,
      section_emoji: emoji,
      entries: val as WebFetchSignalsSection["entries"],
    });
  }
  // Sort: known section labels first (in priority order), then alphabetical.
  sections.sort((a, b) => {
    const ai = SECTION_PRIORITY.findIndex((p) =>
      a.section_label.toLowerCase().includes(p)
    );
    const bi = SECTION_PRIORITY.findIndex((p) =>
      b.section_label.toLowerCase().includes(p)
    );
    const aN = ai < 0 ? SECTION_PRIORITY.length : ai;
    const bN = bi < 0 ? SECTION_PRIORITY.length : bi;
    if (aN !== bN) return aN - bN;
    return a.section_label.localeCompare(b.section_label);
  });
  return sections;
}
