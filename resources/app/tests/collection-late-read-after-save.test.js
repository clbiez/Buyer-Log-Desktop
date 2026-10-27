"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(
    path.join(__dirname, "../public/app-main.js"),
    "utf8",
  ),
  start = source.indexOf("async function kolLoadWorkspace("),
  end = source.indexOf("function kolPersistScope()", start);
function fixture() {
  let release;
  const response = new Promise((r) => (release = r)),
    applied = [];
  const ctx = {
    fetch: () => response,
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 1,
    kolBaseline: { rows: new Map() },
    kolWorkspaceSaving: false,
    kolWorkspaceSaveTimer: null,
    dirty: false,
    kolHasDirtyWorkspace: () => ctx.dirty,
    kolEditingRowIds: () => new Set(),
    kolHasActiveWorkspaceEditor: () => false,
    kolReportReplication: () => {},
    kolApplyWorkspace: (workspace) => {
      applied.push(workspace);
      ctx.kolWorkspaceRevision = workspace._revision;
    },
    document: { getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return {
    ctx,
    applied,
    release: () =>
      release({
        ok: true,
        json: async () => ({
          workspace: { _revision: 1, rows: [{ id: 1, modelKod: "old" }] },
          access: { canEdit: true },
        }),
      }),
  };
}
test("old GET that finishes after a durable save cannot move the UI backwards", async () => {
  const f = fixture(),
    read = f.ctx.kolLoadWorkspace("owner", { preserveLocal: true });
  f.ctx.kolWorkspaceRevision = 2;
  f.release();
  assert.equal(await read, false);
  assert.equal(f.applied.length, 0);
  assert.equal(f.ctx.kolWorkspaceRevision, 2);
});
test("local unsaved edit made while GET was in flight is preserved", async () => {
  const f = fixture(),
    read = f.ctx.kolLoadWorkspace("owner", { preserveLocal: true });
  f.ctx.dirty = true;
  f.release();
  assert.equal(await read, false);
  assert.equal(f.applied.length, 0);
});
test("an unchanged clean workspace still accepts the fetched remote state", async () => {
  const f = fixture(),
    read = f.ctx.kolLoadWorkspace("owner", { preserveLocal: true });
  f.release();
  assert.equal(await read, true);
  assert.equal(f.applied.length, 1);
});
test("automatic remote reload requests the local-state guard", () =>
  assert.match(
    source,
    /await kolLoadWorkspace\(ownerId,\{preserveLocal:true\}\)/,
  ));
test("a delayed SSE revision cannot reduce the workspace revision after a newer ACK", async () => {
  const start = source.indexOf("async function kolHandleRemoteChange("),
    end = source.indexOf(
      "\n/* ===================================================================",
      start,
    );
  const ctx = {
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 12,
    kolWorkspaceSaving: false,
    kolWorkspaceSaveTimer: null,
    kolApplyRemotePatches: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.kolHandleRemoteChange("owner", {
    mode: "patch",
    rowPatches: [],
    revision: 10,
  });
  assert.equal(ctx.kolWorkspaceRevision, 12);
});
test("a read discarded after a local edit schedules a fresh bounded-delay reload", async () => {
  const start = source.indexOf("async function kolHandleRemoteChange("),
    end = source.indexOf(
      "\n/* ===================================================================",
      start,
    ),
    timers = [];
  const ctx = {
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 2,
    kolWorkspaceSaving: false,
    kolWorkspaceSaveTimer: null,
    kolHasDirtyWorkspace: () => false,
    kolEditingRowIds: () => new Set(),
    kolHasActiveWorkspaceEditor: () => false,
    kolSelected: new Set(),
    kolLoadWorkspace: async () => false,
    document: { getElementById: () => null },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.kolHandleRemoteChange("owner", { mode: "reload" });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 200);
});
test("a clean focused editor defers reload without polling full workspace HTTP", async () => {
  const start = source.indexOf("async function kolHandleRemoteChange("),
    end = source.indexOf(
      "\n/* ===================================================================",
      start,
    ),
    timers = [];
  let reads = 0;
  const ctx = {
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 2,
    kolWorkspaceSaving: false,
    kolWorkspaceSaveTimer: null,
    kolRemoteReloadPendingOwner: "",
    kolHasDirtyWorkspace: () => false,
    kolEditingRowIds: () => new Set(["1"]),
    kolHasActiveWorkspaceEditor: () => true,
    kolSelected: new Set(),
    kolLoadWorkspace: async () => {
      reads++;
      return false;
    },
    document: { getElementById: () => null },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  for (let i = 0; i < 3; i++)
    await ctx.kolHandleRemoteChange("owner", { mode: "reload" });
  assert.equal(reads, 0);
  assert.equal(timers.length, 0);
  assert.equal(ctx.kolRemoteReloadPendingOwner, "owner");
});
