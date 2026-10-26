"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  {
    mergeCollectionWorkspaces,
  } = require("../server/lib/collection-replication");
const ws = (revision, row) => ({
  ownerId: "owner",
  _revision: revision,
  rows: [{ id: 1, ...row }],
  nextId: 2,
});
for (const reverse of [false, true])
  test(
    "hydrated empty canonical text is not an edit competing with another device " +
      reverse,
    () => {
      const base = ws(1, { modelKod: "INITIAL" }),
        modelEdit = ws(2, { modelKod: "MODEL-A", specialCode: "" }),
        codeEdit = ws(2, { modelKod: "INITIAL", specialCode: "CODE-B" });
      const result = mergeCollectionWorkspaces(
        base,
        ...(reverse ? [modelEdit, codeEdit] : [codeEdit, modelEdit]),
      );
      assert.equal(result.workspace.rows[0].modelKod, "MODEL-A");
      assert.equal(result.workspace.rows[0].specialCode, "CODE-B");
      assert.deepEqual(result.conflicts, []);
    },
  );
test("empty financial intent and nested override values retain their conflict semantics", () => {
  const result = mergeCollectionWorkspaces(
    ws(1, { modelKod: "M" }),
    ws(2, { modelKod: "M", trFx: "42", pricing: { A: "4" } }),
    ws(2, { modelKod: "M", trFx: "", pricing: { A: "" } }),
  );
  assert.deepEqual(result.conflicts.map((c) => c.field).sort(), [
    "pricing",
    "trFx",
  ]);
});
