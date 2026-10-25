# BL015: existing design system and table density

Explicit compact/standard/comfortable row spacing is independent of the global text scale in CP, Orders and Collection. Default preserves the existing geometry. Image dimensions are unchanged; virtual spacing and the visible row anchor update together. Preferences use the existing user-scoped storage. Corrupt/unknown values fall back to default.

The empty editable Collection starts the existing guarded Add Model path. Filtered results still clear filters; read-only workspaces offer no edit. Real UI acceptance exposed an old focus selector looking for an input although Model Name is a textarea; the shared editor class now targets the actual field. Repeated Manufacturers/Automations body titles were removed; top-bar titles remain.

Targeted validation: 13 files, 81 pass, no failure/skip. Real production server + Edge: 57 density/reflow states, TR/EN, three themes, two font sizes, actual virtual scroll anchor and scoped preference reload; actual empty action creates one row and focuses Model Name. All eight lossless post-change PNGs inspected. No source business data used. Detailed evidence: `bl015-design-density-20261025.json`.

Actual Electron 200% zoom is deferred to BL019, not represented by browser CSS reflow. Final integrated regression/CI/merge is pending. Rollback is the local commit revert; no business data schema migration.
