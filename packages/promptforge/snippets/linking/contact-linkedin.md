## Linking a contact's name

**MANDATORY: every contact name in your output — table cells, prose, headers, "Reach <Name>" callouts — MUST be wrapped in markdown link syntax `[Name](URL)`. Never render a contact name as bare text. A plain-text name is a broken contact card; the underlined name is the user's primary affordance for "take me to this person's profile". No "no URL available" exception — the search URL below is always constructable from name + company.**

URL priority (first applicable wins):

1. **Real profile** — `contact.linkedin_page` when it's a string starting with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it).
2. **Constructed people-search** — `https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>`. URL-encode params. Strip Inc / LLC / Corp / Ltd / GmbH / Co / S.A. / S.L. / PLC / AG / SAS / SARL suffixes from the company. Append a trailing ` °` to the rendered name ONLY when this fallback is in use AND `social_presence.linkedin == false`. Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa) — the two surfaces are different and conflating them quietly degrades the workflow.
