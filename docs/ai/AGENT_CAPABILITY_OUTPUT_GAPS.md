# Explicit output-schema migration gaps

Current executable catalog audit: 180 contract-v2 tools; 152 declare a strict top-level output object; 28 still use a generic verified envelope or an open top-level result. Runtime checks the envelope, but these declarations do not yet provide the complete field-level output contract requested for Platform 2.0. They must not be reported as fully typed simply because contractVersion is 2. This is a pending migration inventory, not a release acceptance result.

| Module | Open output contracts | Registered tool IDs |
|---|---|---|
| koleksiyon | 5 | `collection.plm.fetch`, `collection.plm.import`, `collection.records.create`, `collection.records.update`, `collection.records.delete` |
| quotations | 6 | `quotation.list`, `quotation.apply.collection`, `quotation.create`, `quotation.update`, `quotation.status`, `quotation.approve` |
| source | 7 | `resource.endeksmatik.read`, `resource.endeksmatik.lookup`, `resource.endeksmatik.calculate`, `resource.endeksmatik.activate`, `resource.endeksmatik.rename`, `resource.endeksmatik.delete`, `resource.endeksmatik.import` |
| automations | 10 | `automation.language`, `automation.recipes.read`, `automation.code.preview`, `automation.recipe.create`, `automation.recipe.update`, `automation.recipe.delete`, `automation.recipe.activate`, `automation.recipe.schedule`, `automation.recipe.preview`, `automation.recipe.execute` |

Tighten each adapter group around its real native result and inverse receipt. Dynamic canonical records and analytical columns need a bounded typed value/dictionary or row/cell contract, with declared omissions. Before changing a write result schema, verify the actual native effect/receipt so a valid persisted effect does not become a false failed task because of a newly invented response shape. Preserve the existing engine, IAM, record scope, audit and approval boundary. Validate groups with their actual capability/native regression cases and one focused review; do not combine independent risky adapters into one delivery PR.
