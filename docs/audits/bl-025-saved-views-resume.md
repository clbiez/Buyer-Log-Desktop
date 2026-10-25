# BL025 — personal saved views and resume

The existing view/profile/cache and sharing infrastructure now carries optional versioned canonical column bindings, density, native filters and sorting. Existing favourites and legacy view payloads remain compatible. A separately configured favourite filter keeps its existing startup priority. Current-user transient resume is applied after startup favourites.

The current workspace is remembered locally per user. Scroll and active cell are resolved against current canonical row identity and the existing pagination controller, including a saved fourth-page record. Foreign users/workspaces, reused numeric IDs and missing/filtered rows do not select a replacement. Explicit workspace routes and current access take precedence. Hidden modules are not preloaded.

Live acceptance exposed an existing missing picker-clear helper in system-default reset; it is now implemented and covered. Density and sorting also reset.

Validation: **13 files / 73 passed / 0 failed or skipped**. Actual server/Edge acceptance: **11 phases**, including native Save As/picker restore, fourth-page anchor/active identity, reused ID rejection, reload/explicit route, default reset, existing share preview, TR/EN/three themes, separate Buyer session and Collection custom columns/sort/density. Screenshots inspected. [Machine-readable evidence](bl025-view-context-20261025.json).

Final integrated full/CI/merge and Electron acceptance remain pending. No publication was started.
