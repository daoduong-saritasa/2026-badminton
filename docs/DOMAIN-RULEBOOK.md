# Domain Model & Decisions
<!-- domain-rulebook v1 -->

Three homes for terminology and decisions — keep them from bleeding into each
other. The `domain-modeling` skill (and `grill-with-docs`, which folds it into a
grilling session) maintains the first two.

- **`CONTEXT.md`** (repo root) — the ubiquitous-language glossary, and nothing
  else. Use its canonical terms (and avoid the `_Avoid_` synonyms) in code,
  docs, specs, and UI copy. It is devoid of implementation detail: no schema, no
  file references, no "how it works". Add or sharpen a term the moment grilling
  resolves one; never let it become a spec or scratchpad.
- **`docs/adr/`** — one short ADR per **app-wide** decision that is hard to
  reverse, surprising without context, and the result of a real trade-off (all
  three, or it is not an ADR). A handful, ever. Numbered `NNNN-slug.md`, 1–3
  sentences.
- **`specs/<feature>/PLAN.md` "Decisions"** — feature-scoped choices that live
  and die with the spec. The default home. If a decision only matters inside one
  feature, it stays here and does **not** become an ADR.
