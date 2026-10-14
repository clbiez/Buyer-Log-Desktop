# Native module audit (Pricing History, Price & Supplier, holidays, INTAKE)

Operation-by-operation inventory of the remaining modules against the unified access matrix. No grant is inferred: every new adapter has an explicit matrix decision.

| Module / function | Native route or engine | Office capability | Decision |
|---|---|---|---|
| Price & Supplier Analysis — Horizon source analysis | `/api/data/price-analysis` + `price-supplier-insights-engine` | `priceanalysis.insights.read` (READ, `priceanalysis` area) | Added. Rows come from the same `priceAnalysisRowsFor` (IAM scope, effective Horizon, date overrides). The observation builder moved from `app-main.js` into the shared engine; the screen and the agent use it, and a browser comparison of old and new bridge output for horizon/orders/cp × Final/Supplier FOB was identical. Aggregates only, no raw rows. |
| Price & Supplier Analysis — CP/Orders/LFL/Collection sources | screen bridge over loaded projections | `cp.analyze`, `orders.analyze`, `lfl.*`, `collection.supplier.analyze` | Existing generic analysis tools cover these sources. |
| Pricing History | client screen over quotations + collection | `quotation.list`, `collection.records`, `collection.pricing.*` | No separate store or route exists; covered. |
| World-clock public holidays | `/api/world-clock-holidays` → `holiday-service` | `overview.holidays.read` (READ, `overview`) | Added. Only ISO country code + year leave Buyer Log. Provider failure → `OFFICE_HOLIDAY_UNAVAILABLE` (TR/EN). |
| INTAKE state/metadata | `/api/intake/state`, `/api/intake/metadata` | `intake.snapshot.read`, `oab.*` | Existing. |
| INTAKE settings write | `PUT /api/intake/settings` | — | Stays user-only (connection/settings change; no agent use case approved). |

Validation: `tests/agent-price-analysis-tools.test.js` (4 cases incl. holidays), the price-supplier test files (source-contract assertions kept, pointed at the shared engine), unified access matrix and i18n guard. Real anonymous HTTP/Chromium acceptance on an isolated demo server (TR/EN): Office read 220 records with season comparison and supplier ranking, the Price & Supplier screen renders all sources with zero page errors, and the India 2026 holiday read completed.
