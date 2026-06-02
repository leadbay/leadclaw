import type { LeadbayClient } from "../client.js";

// Remaining AI-credit balance from /users/me → organization.billing.ai_credits
// (types.ts BillingStatePayload). Returns null when billing is absent (older
// backend, or org without billing wired) — callers must treat null as
// "unknown", never as zero.
//
// `force` bypasses the 60s /me cache. Pass force=true AFTER a paid op so the
// post-spend balance is fresh; leave false for a pre-op BEFORE read where the
// cached value is fine.
export async function readCreditsRemaining(
  client: LeadbayClient,
  force = false
): Promise<number | null> {
  try {
    const me = await client.resolveMe(force);
    return me.organization.billing?.ai_credits ?? null;
  } catch {
    // Advisory only — never let a billing read failure break the enrichment
    // flow. The caller surfaces null = "unknown".
    return null;
  }
}

// Sum credits_used across a flat contact list. Each ContactPayload carries an
// optional enrichment.credits_used (types.ts ContactEnrichment). Older backends
// omit it entirely → those contacts contribute 0 and the total is a lower
// bound. Returns { total, any_reported }: any_reported is false when NO contact
// reported a number, letting the caller distinguish "0 credits spent" from
// "backend didn't report cost".
export function sumCreditsUsed(contacts: unknown): {
  total: number;
  any_reported: boolean;
} {
  if (!Array.isArray(contacts)) return { total: 0, any_reported: false };
  let total = 0;
  let anyReported = false;
  for (const c of contacts) {
    const used = (c as any)?.enrichment?.credits_used;
    if (typeof used === "number" && Number.isFinite(used)) {
      total += used;
      anyReported = true;
    }
  }
  return { total, any_reported: anyReported };
}
