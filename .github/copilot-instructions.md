# Buyer Log — shared development instructions

Read the short `AGENTS.md` before editing; open only the relevant section of the
canonical `CLAUDE.md` when you need detail. Every update and new module picks a
performance tier (N/A / L1 / L2) from `docs/PERFORMANCE_ACCEPTANCE.md` §0 and reports
the tier, verdict and evidence in `.github/pull_request_template.md`. Use the same rules locally and in Cloud;
do not introduce an independent tool-specific contract.
