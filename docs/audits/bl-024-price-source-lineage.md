# BL024 — price source explanations

The existing price drawer now shows the canonical selected price source, matching rule, requested/applied FX month, source date/age and revisions. CP/Orders reuse this drawer as a read-only source view from the contextual palette. The existing detail drawer exports a source/assumption report to Excel, retaining native values. Unknown dates remain unknown.

The drawer is bound to the current session, workspace, owner, source ID and canonical model identity. A stale focused drawer closes, detached inputs are rejected, and language refresh preserves the draft without committing it. Rule navigation rechecks current management permission and matching rule.

Validation: **26 files / 160 passed / 0 failed or skipped**. Actual production-server/Edge acceptance has **14 phases**, including native FX editing, confirmed/best/target precedence, three themes, TR/EN draft preservation, actual Excel report values, stale workspace/readonly rejection, rule editor selection, real ledger import followed by manual approval and a separate Buyer management restriction. Controlled client fixtures are explicitly labelled in the JSON report.

A single independent review found the native cpupdate origin mismatch and approval-event source/date misattribution; RED/GREEN regressions and native checks cover the fixes. The root also bounded ledger provenance by owner/model identity and prevented reuse of an older equal-price offer timestamp.

Evidence/limits: [machine-readable report](bl024-price-lineage-20261025.json). Final integrated full, current-head CI and GitHub merge are pending. No publication workflow was dispatched.
