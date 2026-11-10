# Fabric Card review fixes — acceptance plan

- Scope: repair three reproduced defects in PR #967; no merge or TEST/STABLE publication.
- Pre-change PR source: `49c41e168795636a47c8776852f3d4b04c3ab37d`.
- Main observed before edits: `76cf2029c55950a5442a1fd0e0bf7887bbf25ef4`.
- Risk: P1, offline per-card revision ancestry and translation correctness.
- Scenarios: repeated pending saves/deletes, a real newer peer revision, another save during publication, changing source language during debounce/in-flight/failure, manual correction, English dialog labels.
- Budgets: zero extra startup work, pollers, SSE streams, or idle network requests; at most the existing one debounced request per edited unknown segment; cancelled/deposed responses must never change the draft; visible feedback <=200 ms; no new >50 ms blocking tasks. Outbox ancestry bookkeeping is constant work per affected code, with no new per-edit disk write or full-library copy. Successful publication uses at most its existing one cleanup write: if another local save superseded the entry during mirror, that write records the confirmed new base instead of deleting the newer entry. A failed mirror must not advance ancestry from its optimistic memory stage.
- Compare identical synthetic input on baseline and candidate for editor mount/input/language switch/dispose and outbox saves/flush. Record raw samples; these component measurements do not replace the parent PR's outstanding Main/product/Electron/real Shared Hub acceptance gates.
- Any unavailable required product gate remains BLOCKED. Do not infer a full performance PASS from unit tests or isolated browser checks.
