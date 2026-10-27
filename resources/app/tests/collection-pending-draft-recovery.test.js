"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  vm = require("node:vm");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bl-draft-recovery-"));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, "server"),
  BUYER_LOG_DATA_ROOT: path.join(root, "app"),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, "local"),
  BUYER_LOG_CONFIG_PATH: path.join(root, "config.json"),
});
const store = require("../server/lib/collection-workspaces");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const source = fs.readFileSync(
  path.join(__dirname, "../public/app-main.js"),
  "utf8",
);
function fn(name) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) return "";
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const clone = (v) => JSON.parse(JSON.stringify(v)),
  structure = (rows) =>
    JSON.stringify({
      columns: [],
      manufacturers: [],
      statusCatalog: [],
      order: rows.map((r) => String(r.id)),
    });
function fixture(pending, fresh) {
  const ctx = {
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceCanEdit: true,
    kolWorkspaceRevision: 9,
    kolRows: clone(fresh),
    kolBaseline: {
      ownerId: "owner",
      rows: new Map(fresh.map((r) => [String(r.id), clone(r)])),
      structure: structure(fresh),
    },
    kolManufacturers: [],
    kolCustomCols: [],
    kolStatusCatalog: [],
    kolNextId: 20,
    kolReadPendingWorkspace: () => clone(pending),
    kolNormalizeStatusCatalog: (x) => x || [],
    kolNormalizeModelGroups: (x) => x,
    migrateKolRow: (r) => ({ ...r }),
    kolNormalizeCustomCols: (x) => x,
    kolRowKey: (r) => String(r.id),
    kolPersistableRow: (r) => ({ ...r }),
    kolStatusEntries: () => ctx.kolStatusCatalog,
    kolManufacturersForPersistence: () => ctx.kolManufacturers,
    refreshSubmfrList: () => {},
    loadKolColState: () => {},
    renderKol: () => {},
    scheduleOverviewCollectionSummaryRender: () => {},
    kolClearPendingWorkspace: () => {
      ctx.cleared = true;
    },
    kolHasDirtyWorkspace: () => !ctx.kolCollectChanges().empty,
  };
  ctx.kolStructureSignature = () =>
    JSON.stringify({
      columns: ctx.kolCustomCols,
      manufacturers: ctx.kolManufacturers,
      statusCatalog: ctx.kolStatusCatalog,
      order: ctx.kolRows.map((r) => String(r.id)),
    });
  vm.createContext(ctx);
  for (const name of [
    "kolValueEqual",
    "kolRowEqual",
    "kolRowChangedFromBase",
    "kolCloneConflictValue",
    "kolMergeLocalRowDelta",
    "kolMergePendingWorkspace",
    "kolRestorePendingWorkspace",
    "kolCollectChanges",
  ]) {
    const code = fn(name);
    if (code) vm.runInContext(code, ctx);
  }
  ctx.kolRestorePendingWorkspace();
  return ctx;
}
const base = [{ id: 1, _rev: 7, modelKod: "original", not: "base" }],
  draft = (rows) => ({
    schemaVersion: 2,
    ownerId: "owner",
    rows,
    baseRows: clone(base),
    baseStructure: structure(base),
    baseRevision: 7,
    statusCatalog: [],
    manufacturers: [],
    customColumns: [],
    nextId: 20,
  });
test("offline edit + peer delete + refresh retains existence intent and remote-only additions", async () => {
  const peer = { id: 2, _rev: 9, modelKod: "peer addition" },
    ctx = fixture(draft([{ ...base[0], not: "offline edit" }]), [peer]),
    change = ctx.kolCollectChanges();
  assert.deepEqual(Array.from(change.expectedExistingIds), ["1"]);
  assert.equal(change.deletes.length, 0);
  assert.ok(ctx.kolRows.some((r) => r.id === 2));
  const current = (
    await store.saveWorkspaceAsync("owner", { rows: [peer], nextId: 20 }, 0)
  ).saved;
  const result = store.applyRowChanges(current, {
    ...change,
    structure: undefined,
  });
  assert.equal(
    result.applied.some((x) => x.id === "1"),
    false,
  );
  assert.ok(
    result.conflicts.some((x) => x.id === "1" && x.reason === "row-missing"),
  );
  assert.equal(
    result.saved.rows.some((r) => r.id === 2),
    true,
  );
});
test("an unchanged draft row deleted remotely stays deleted", () => {
  const ctx = fixture(draft(base), [
    { id: 2, _rev: 9, modelKod: "peer addition" },
  ]);
  assert.equal(
    ctx.kolRows.some((r) => r.id === 1),
    false,
  );
  assert.ok(ctx.kolRows.some((r) => r.id === 2));
  assert.equal(ctx.kolCollectChanges().empty, true);
});
test("pending delete retains the original row CAS instead of deleting a newer peer edit", () => {
  const peer = { ...base[0], not: "peer edit", _rev: 9 },
    ctx = fixture(draft([]), [peer]),
    change = ctx.kolCollectChanges();
  assert.equal(change.deletes[0]._rev, 7);
});
test("a new draft ID colliding with an unversioned peer row is a create conflict", () => {
  const p = draft([{ id: 3, modelKod: "draft create" }]);
  p.baseRows = [];
  p.baseStructure = structure([]);
  const current = {
      schemaVersion: 1,
      ownerId: "owner",
      _revision: 9,
      rows: [{ id: 3, modelKod: "peer create" }],
      manufacturers: [],
      customColumns: [],
      statusCatalog: [],
      nextId: 4,
    },
    ctx = fixture(p, current.rows),
    change = ctx.kolCollectChanges();
  assert.deepEqual(Array.from(change.expectedNewIds), ["3"]);
  const result = store.applyRowChanges(current, {
    ...change,
    structure: undefined,
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.conflicts[0].reason, "row-exists");
  assert.equal(result.saved.rows[0].modelKod, "peer create");
});

test("legacy drafts retain unknown original intent conservatively across repeated reloads", () => {
  const pending = {
      ownerId: "owner",
      rows: [{ id: 1, _rev: 7, modelKod: "legacy edit" }],
    },
    fresh = [{ id: 2, _rev: 9, modelKod: "peer addition" }],
    ctx = fixture(pending, fresh),
    change = ctx.kolCollectChanges();
  assert.deepEqual(Array.from(change.expectedExistingIds), ["1"]);
  assert.equal(change.upserts[0]._rev, 7);
  assert.equal(change.expectedNewIds.length, 0);
  assert.ok(ctx.kolRows.some((r) => r.id === 2));
  const again = fixture(
    {
      ...pending,
      schemaVersion: 2,
      baseRows: [...ctx.kolBaseline.rows.values()],
      baseStructure: ctx.kolBaseline.structure,
      expectedExistingIds: [...ctx.kolBaseline.expectedExistingIds],
    },
    fresh,
  );
  assert.deepEqual(Array.from(again.kolCollectChanges().expectedExistingIds), [
    "1",
  ]);
});
test("bootstrap loads the saved authorized shared scope before initializing the personal workspace", async () => {
  const start = source.indexOf("async function initKolWorkspaces("),
    end = source.indexOf("\n// Collection Status", start),
    reads = [],
    applied = [];
  const ctx = {
    kolWorkspaceOwnerId: "personal",
    kolWorkspaceList: [],
    kolWorkspaceSharedMode: false,
    kolPermissionState: null,
    KOL_SCOPE_PREF_KEY: "scope",
    BLStorage: { getItem: () => JSON.stringify({ ownerIds: ["shared"] }) },
    document: { getElementById: () => null },
    kolLoadPermissions: async () => {},
    kolFetchJson: async (url) => {
      reads.push(url);
      return url === "/api/collection-workspaces"
        ? {
            workspaces: [{ ownerId: "personal" }, { ownerId: "shared" }],
            shared: false,
          }
        : {
            workspace: { initialized: true, rows: [] },
            access: { canEdit: true },
          };
    },
    kolReportReplication: () => {},
    kolApplyWorkspace: () => applied.push(ctx.kolWorkspaceOwnerId),
    renderKolScopeFilters: () => {},
    kolLoadWorkspaceBatch: async () =>
      assert.fail("single saved scope should already be loaded"),
    kolWorkspaceSetReadonly: () => {},
    kolIsNetworkError: () => false,
    showToast: (e) => assert.fail(e),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.initKolWorkspaces();
  assert.deepEqual(reads, [
    "/api/collection-workspaces",
    "/api/collection-workspaces/shared",
  ]);
  assert.deepEqual(applied, ["shared"]);
});
test("workspace application restores pending intent before a pricing render may persist it", () => {
  let pending = "original draft";
  const events = [],
    ctx = {
      kolWorkspaceOwnerId: "owner",
      kolRows: [],
      kolSelected: new Set(),
      kolNormalizeStatusCatalog: (x) => x || [],
      kolNormalizeModelGroups: (x) => x,
      migrateKolRow: (x) => x,
      kolNormalizeCustomCols: (x) => x,
      refreshSubmfrList: () => {},
      loadKolColState: () => {},
      kolWorkspaceSetReadonly: () => {},
      kolCaptureBaseline: () => events.push("capture"),
      kolPersistableRow: (x) => x,
      kolManufacturersForPersistence: () => [],
      kolStatusEntries: () => [],
      localStorage: { setItem: () => {} },
      kolRestorePendingWorkspace: () => {
        assert.equal(pending, "original draft");
        events.push("restore");
        return false;
      },
      renderKol: () => {
        events.push("render");
        pending = "render normalization";
      },
      scheduleOverviewCollectionSummaryRender: () => {},
    };
  vm.createContext(ctx);
  vm.runInContext(fn("kolApplyWorkspace"), ctx);
  ctx.kolApplyWorkspace(
    { _revision: 2, rows: [{ id: 1 }], customColumns: [] },
    { canEdit: true },
  );
  assert.deepEqual(events, ["capture", "restore", "render"]);
});
