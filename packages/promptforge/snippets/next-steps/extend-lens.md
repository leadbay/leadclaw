## NEXT STEPS — after `leadbay_seed_candidates` or `leadbay_extend_lens`

{{include:next-steps/ask-user-input-routing}}

Pick 2–3 items below based on what the response actually contains.

### After `leadbay_seed_candidates`

| Observation                                          | Suggest                                                    | Calls                                                        |
|------------------------------------------------------|------------------------------------------------------------|--------------------------------------------------------------|
| User approves the agent's recommended seeds          | "Fire the extend with these N seeds"                       | `leadbay_extend_lens(seed_lead_ids=[…picked lead_ids], extra_count=N)` |
| User wants to skip seeds and just fill more          | "Extend with no seeds (default-strategy fill)"             | `leadbay_extend_lens()`                                      |
| User wants to swap one seed                          | "Swap a seed and refire"                                   | Re-emit recommendation table with the swap, then `leadbay_extend_lens` |
| User wants a different audience instead              | "Adjust the lens filters (sector / size)"                  | `leadbay_adjust_audience(...)`                               |

### After `leadbay_extend_lens` — depends on `status`

| `status`                | Suggest                                                       | Calls                                                  |
|-------------------------|---------------------------------------------------------------|--------------------------------------------------------|
| `queued`                | "Pull leads in ~30s to see the new ones"                      | `leadbay_pull_leads()` (after a short wait)            |
| `quota_exceeded`        | "Try with a smaller `extra_count`"                            | `leadbay_extend_lens(extra_count=<smaller>)`           |
| `quota_exceeded`        | "Wait until the daily quota resets at `<resets_at>`"          | (no call — surface the reset time to the user)         |
| `quota_exceeded`        | "Upgrade plan for a higher daily limit"                       | (no call — direct user to contact account manager / sales) |
| `refresh_in_progress`   | "Lens is already filling — pull leads in a minute"            | `leadbay_pull_leads()` (after a short wait)            |
| `no_valid_seeds`        | "Seeds are stale — refetch fresh candidates and retry"        | `leadbay_seed_candidates()` then `leadbay_extend_lens` |

If nothing in the menu applies cleanly, suggest only "pull leads now to see the queued additions" — never invent a tool that doesn't exist.
