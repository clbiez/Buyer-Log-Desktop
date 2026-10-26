"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  vm = require("node:vm");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bl-deleted-stale-"));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, "server"),
  BUYER_LOG_DATA_ROOT: path.join(root, "app"),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, "local"),
  BUYER_LOG_CONFIG_PATH: path.join(root, "config.json"),
});
const store = require("../server/lib/collection-workspaces");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
for (const revision of [undefined, 7])
  test(
    "stale editor cannot resurrect a deleted row, including legacy revision " +
      revision,
    async () => {
      const owner = "deleted-" + String(revision);
      const row = {
        id: 1,
        modelKod: "synthetic",
        not: "original",
        ...(revision === undefined ? {} : { _rev: revision }),
      };
      await store.saveWorkspaceAsync(owner, { rows: [row], nextId: 2 }, 0);
      await store.applyRowChangesAsync(owner, {
        deletes: [{ id: 1, _rev: revision }],
      });
      const before = store.loadWorkspace(owner);
      const result = await store.applyRowChangesAsync(owner, {
        upserts: [{ ...row, not: "stale edit" }],
        expectedExistingIds: ["1"],
      });
      assert.equal(result.applied.length, 0);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0].reason, "row-missing");
      assert.equal(result.conflicts[0].current, null);
      assert.deepEqual(
        store.loadWorkspace(owner),
        before,
        "rejection cannot change durable state",
      );
    },
  );
test("a genuine create and explicit recycle-bin restore with a new ID still work", async () => {
  const result = await store.applyRowChangesAsync("new", {
    upserts: [{ id: 2, not: "restored", _rev: 7 }],
    expectedExistingIds: [],
  });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.applied.length, 1);
});
test("real client diff carries existence expectations only for rows in its baseline", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/app-main.js"),
    "utf8",
  );
  const start = source.indexOf("function kolCollectChanges()"),
    end = source.indexOf("// Kaydedilemeyen satırlar", start);
  const rows = [
      { id: 1, not: "changed" },
      { id: 2, not: "new" },
    ],
    baseline = {
      ownerId: "owner",
      rows: new Map([["1", { id: 1, not: "old" }]]),
      structure: "same",
    };
  const ctx = {
    kolRows: rows,
    kolBaseline: baseline,
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 4,
    kolNextId: 3,
    kolRowKey: (r) => String(r.id),
    kolPersistableRow: (r) => ({ ...r }),
    kolRowEqual: (a, b) => a.not === b.not,
    kolStructureSignature: () => "same",
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const change = ctx.kolCollectChanges();
  assert.deepEqual(Array.from(change.expectedExistingIds), ["1"]);
});
