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
  start = source.indexOf("function kolApplyRemotePatches("),
  end = source.indexOf("\nfunction kolHighlightRemoteRows", start);
function fixture({ editor = true, rowEditor = true } = {}) {
  let renders = 0;
  const rows = [
      { id: 1, modelKod: "local", _rev: 1 },
      { id: 2, modelKod: "old-peer", _rev: 1 },
    ],
    ctx = {
      kolRows: rows,
      kolSelected: new Set(),
      kolWorkspaceOwnerId: "owner",
      kolWorkspaceCanEdit: true,
      kolSyncLicensorsFromRules: () => 0,
      kolSyncRulePricing: () => 0,
      saveKolRows: () => {},
      kolWorkspaceRevision: 1,
      kolBaseline: {
        ownerId: "owner",
        rows: new Map(rows.map((r) => [String(r.id), { ...r }])),
      },
      kolNextId: 3,
      kolRemoteRenderPendingOwner: "",
      kolHasActiveWorkspaceEditor: () => editor,
      kolEditingRowIds: () => (rowEditor ? new Set(["1"]) : null),
      kolDirtyRowIds: () => new Set(),
      kolRowIndexById: (id) =>
        ctx.kolRows.findIndex((r) => String(r.id) === String(id)),
      migrateKolRow: (r) => r,
      document: { activeElement: editor ? { matches: () => true } : null },
      renderKol: () => renders++,
      kolHighlightRemoteRows: () => {},
      scheduleOverviewCollectionSummaryRender: () => {},
      localStorage: { setItem: () => {} },
      kolWorkspaceLocalKey: () => "",
      kolManufacturersForPersistence: () => [],
      kolCustomCols: [],
      kolStatusEntries: () => [],
    };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return {
    ctx,
    renders: () => renders,
    patch: (rev) =>
      ctx.kolApplyRemotePatches([
        { kind: "changed", row: { id: 2, modelKod: "peer-" + rev, _rev: rev } },
      ]),
  };
}
test("unrelated remote patches update data and baseline without detaching an active row editor", () => {
  const f = fixture();
  assert.equal(f.patch(2), 1);
  assert.equal(f.ctx.kolRows[1].modelKod, "peer-2");
  assert.equal(f.ctx.kolBaseline.rows.get("2").modelKod, "peer-2");
  assert.equal(f.renders(), 0);
  assert.equal(f.ctx.kolRemoteRenderPendingOwner, "owner");
});
test("focused Collection search is not replaced by a remote redraw", () => {
  const f = fixture({ rowEditor: false });
  f.patch(2);
  assert.equal(f.renders(), 0);
});
test("idle Collection still renders incoming changes immediately", () => {
  const f = fixture({ editor: false, rowEditor: false });
  f.patch(2);
  assert.equal(f.renders(), 1);
});

test("background render recalculates the model but leaves the active editor DOM intact", () => {
  const a = source.indexOf("function renderKol("),
    b = source.indexOf("\nfunction kolSpreadsheetFormulaInfo", a);
  let recalculated = 0;
  const ctx = {
    document: { getElementById: () => ({}) },
    kolRenderSaveFeedback: () => {},
    kolWorkspaceCanEdit: true,
    kolWorkspaceOwnerId: "owner",
    kolBaseline: { ownerId: "owner" },
    syncKolPlmFromCp: () => {},
    kolSyncLicensorsFromRules: () => false,
    kolSyncRulePricing: () => {
      recalculated++;
      return false;
    },
    kolHasActiveRowEditor: () => true,
    kolRemoteRenderPendingOwner: "",
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(a, b), ctx);
  ctx.renderKol();
  assert.equal(recalculated, 1);
  assert.equal(ctx.kolRemoteRenderPendingOwner, "owner");
});

test('deferred focusout refresh waits for pointer release before replacing its click target', async () => {
  const a=source.indexOf('function kolResumeDeferredRemoteChanges('), b=source.indexOf('/* Kirli-workspace uyarısı',a);
  let renders=0;const timers=[],events={},ctx={
    kolPointerActive:false,kolDeferredPatches:[],kolRemoteReloadPendingOwner:'',kolRemoteRenderPendingOwner:'owner',kolWorkspaceOwnerId:'owner',
    setTimeout:fn=>timers.push(fn),kolSettlePendingSave:async()=>{},kolApplyRemotePatches:()=>{},kolHandleRemoteChange:()=>{},
    kolHasActiveWorkspaceEditor:()=>ctx.kolPointerActive,renderKol:()=>renders++,
    document:{addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:()=>{}},
  };vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
  events.pointerdown({target:{closest:()=>true}});events.focusout();await timers.shift()();
  assert.equal(renders,0);assert.equal(ctx.kolRemoteRenderPendingOwner,'owner');
  events.pointerup();assert.equal(renders,0,'native click runs before the release timer');
  await timers.shift()();await timers.shift()();
  assert.equal(renders,1);assert.equal(ctx.kolRemoteRenderPendingOwner,'');
});

test('deferred remote paint still refreshes automatic rule fields before another calculation can open',()=>{
 const f=fixture({editor:true,rowEditor:false});let saves=0;
 f.ctx.kolWorkspaceCanEdit=true;
 f.ctx.kolSyncLicensorsFromRules=()=>0;
 f.ctx.kolSyncRulePricing=options=>{assert.equal(options.save,true);f.ctx.kolRows[1].royalty='25,00%';saves++;return 1};
 f.ctx.saveKolRows=()=>{throw Error('the existing pricing synchronizer already queued the save')};
 f.ctx.kolApplyRemotePatches([{kind:'changed',row:{id:2,modelKod:'peer-2',_rev:2,royalty:'27,00%'}}]);
 assert.equal(f.ctx.kolRows[1].royalty,'25,00%','current loaded automatic rule must already be projected');
 assert.equal(f.ctx.kolBaseline.rows.get('2').royalty,'27,00%','keep actual accepted incoming baseline/CAS distinct from derived projection');
 assert.equal(saves,1);assert.equal(f.renders(),0,'the focused editor DOM must remain attached');
});
