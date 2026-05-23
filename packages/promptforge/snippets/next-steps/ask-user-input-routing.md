**RENDER NEXT STEPS via `ask_user_input_v0` when the host exposes it.**

The (Observation, Suggest, Calls) table below is the source of truth for which moves are valid. Pick the 2–4 most relevant rows based on what the response actually contains, then surface them as a `single_select` quick-select widget:

```
ask_user_input_v0({
  questions: [{
    question: "What next?",
    type: "single_select",
    options: [
      "<Suggest column from row 1>",
      "<Suggest column from row 2>",
      "<Suggest column from row 3>"
    ]
  }]
})
```

When the user picks an option, you call the matching tool from the `Calls` column. Constraints carried over from the widget contract: 2–4 mutually-exclusive options per question, button-sized labels (≤6 words), max 3 questions per call.

**Fallback prose mode** — when the host doesn't expose `ask_user_input_v0` (or it returned an error): surface the same 2–3 picks as a short bulleted list of "Suggest" phrasings. The table itself stays internal; never recite the whole table to the user.

---
