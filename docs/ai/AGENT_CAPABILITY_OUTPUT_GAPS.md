# Explicit output-schema migration gaps

Current executable catalog audit: 180 contract-v2 tools; 174 declare a strict top-level output object; 6 still use a generic verified envelope or an open top-level result. Runtime checks the envelope, but these declarations do not yet provide the complete field-level output contract requested for Platform 2.0. They must not be reported as fully typed simply because contractVersion is 2. This is a pending migration inventory, not a release acceptance result.

| Module | Open output contracts | Registered tool IDs |
|---|---|---|
| automations | 6 | `automation.recipe.create`, `automation.recipe.update`, `automation.recipe.delete`, `automation.recipe.activate`, `automation.recipe.schedule`, `automation.recipe.execute` |

Tighten each adapter group around its real native result and inverse receipt. Dynamic canonical records and analytical columns need a bounded typed value/dictionary or row/cell contract, with declared omissions. Before changing a write result schema, verify the actual native effect/receipt so a valid persisted effect does not become a false failed task because of a newly invented response shape. Preserve the existing engine, IAM, record scope, audit and approval boundary. Validate groups with their actual capability/native regression cases and one focused review; do not combine independent risky adapters into one delivery PR.
