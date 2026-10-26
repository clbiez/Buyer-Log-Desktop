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
  start = source.indexOf("function kolPersistPendingWorkspace("),
  end = source.indexOf("\nfunction kolReadPendingWorkspace", start),
  UI = require("../public/ui-primitives");
function fixture(previous) {
  let stored;
  const ctx = {
    kolWorkspaceCanEdit: true,
    kolWorkspaceOwnerId: "owner",
    kolWorkspaceRevision: 1,
    kolBaseline: {
      ownerId: "owner",
      rows: new Map([["1", { id: 1, modelKod: "old" }]]),
      structure: "{}",
    },
    kolRows: [{ id: 1, modelKod: "draft" }],
    kolManufacturers: [],
    kolCustomCols: [],
    kolNextId: 2,
    kolStatusEntries: () => [],
    kolPersistableRow: (r) => r,
    kolWorkspacePendingKey: () => "draft",
    localStorage: { setItem: (k, v) => (stored = JSON.parse(v)) },
    kolSaveFeedbackByOwner: new Map(previous ? [["owner", previous]] : []),
    kolSetSaveFeedback: (status, detail = "") =>
      ctx.kolSaveFeedbackByOwner.set("owner", { status, detail }),
    showToast: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, stored: () => stored };
}
test("a secured browser draft must not claim durable server acceptance", () => {
  const f = fixture();
  assert.equal(f.ctx.kolPersistPendingWorkspace("pending"), true);
  const state = f.ctx.kolSaveFeedbackByOwner.get("owner").status;
  assert.equal(state, "draft");
  for (const language of ["tr", "en"]) {
    const html = UI.persistenceView(state, { language });
    assert.match(html, /data-persistence-state="draft"/);
    assert.doesNotMatch(html, /Bu cihazda kaydedildi|Saved on this device/);
  }
  assert.equal(f.stored().rows[0].modelKod, "draft");
});
test("remote change notification cannot replace a rejected save with a saved badge", () => {
  for (const status of ["conflict", "failed"]) {
    const f = fixture({ status, detail: "rejected" });
    f.ctx.kolPersistPendingWorkspace("remote-change");
    assert.equal(f.ctx.kolSaveFeedbackByOwner.get("owner").status, status);
    assert.equal(f.ctx.kolSaveFeedbackByOwner.get("owner").detail, "rejected");
  }
});
test("in-flight save remains distinct from an idle local draft", () => {
  const f = fixture();
  f.ctx.kolPersistPendingWorkspace("saving");
  assert.equal(f.ctx.kolSaveFeedbackByOwner.get("owner").status, "sending");
});
