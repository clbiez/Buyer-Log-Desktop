# BL-011 — explicit manual patch publication boundary

User approval in the execution conversation selected staged signed-patch
migration, explicit approval for every publication, and no Actions ZIP storage.
This focused change freezes the existing unsigned auto publisher while the
trusted bootstrap/v3 implementation is pending. Existing installed patches,
downloads and feed files are retained; no release or feed deletion occurs.

The former workflow now runs only by explicit workflow_dispatch for an exact
reviewed current-main SHA. It has read-only repository permissions, no release
or signing secrets, no publish commands and no Actions ZIP upload/download.
Therefore a docs-only commit, scheduled event, merge or untrusted PR cannot
publish an executable patch. Unlike the previous packaging-only test gate, full
application regressions must pass before the retained Windows compatibility,
apply and rollback tests run. Failure stops packaging; errors are not hidden.

This is a deliberately visible transitional policy, not an implemented signed
installer or a claim that BL-005 is fixed. A future signed publisher must use an
explicitly requested publication entry point after the installed trusted bootstrap and v3
acceptance matrix exist. Existing unsigned offline tooling is still available
and still lacks publisher authenticity. No automatic notification/background
operation is added. The proposal and unresolved trust risks are in PR693.

Validation: Node-only publication contract tests cover absence of automatic
triggers, untrusted-head execution, secrets, publication capability and artifact
storage; exact-source gating; and failure ordering before installer tests.
No GitHub workflow was dispatched. Actual Windows full regression and installer
execution are not executed here. Existing BL-006 baseline failures will block
packaging until resolved; this is intentional rather than bypassed.

Rollback is a reviewed workflow revert, but doing so restores unsigned
automatic publication and conflicts with the newly approved policy. Do not
re-enable publication as a routine rollback. No runtime data/schema/UI changes;
no synthetic screenshot is supplied for an unchanged application screen.
