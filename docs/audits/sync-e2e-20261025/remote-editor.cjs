"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  B = require("../../../resources/app/scripts/sync-e2e/browser.cjs"),
  assert = require("node:assert/strict");
const root = process.argv[2] || "/workspace/scratch/bl-remote-editor";
let rt, browser;
(async () => {
  try {
    rt = await R.setup(root, { users: 2, backends: 1, port: 6590 });
    browser = await B.launch();
    const m = rt.manifest,
      a = await B.open(browser, rt.servers[0], m.accounts[0], m.owner, {
        trace: true,
      }),
      b = await B.open(browser, rt.servers[0], m.accounts[1], m.owner);
    const log = (x) =>
      R.fs.appendFileSync(
        R.path.join(root, "operations.jsonl"),
        JSON.stringify({ at: Date.now(), ...x }) + "\n",
      );
    B.instrument(a, log);
    B.instrument(b, log);
    await B.settle(a);
    await B.settle(b);
    await a.page.evaluate(() => {
      window.__heldEditor = document.querySelector(
        '.editCell[data-id="1"][data-k="modelKod"]',
      );
      window.__heldEditor.focus();
      window.__heldEditor.value = "UNCOMMITTED-LOCAL-TEXT";
      window.__heldEditor.dispatchEvent(new Event("input", { bubbles: true }));
      renderKol();
    });
    b.currentOp = { id: "peer-other-row" };
    await B.edit(b, 2, "PEER-OTHER-ROW");
    await a.page.waitForFunction(
      () => kolRows.some((r) => r.id === 2 && r.modelKod === "PEER-OTHER-ROW"),
      null,
      { timeout: 10000 },
    );
    const during = await a.page.evaluate(() => ({
      connected: window.__heldEditor.isConnected,
      active: document.activeElement === window.__heldEditor,
      value: window.__heldEditor.value,
      model: kolRows.find((r) => r.id === 1).modelKod,
      feedback: kolSaveFeedbackByOwner.get(kolWorkspaceOwnerId),
    }));
    R.fs.writeFileSync(
      R.path.join(root, "during.json"),
      JSON.stringify(during, null, 2),
    );
    await a.page.screenshot({
      path: R.path.join(root, "remote-while-editing.png"),
    });
    assert.equal(during.feedback.status, "editing");
    assert.equal(
      during.connected,
      true,
      "unrelated remote patch must not detach the active editor",
    );
    assert.equal(during.active, true, "active editor retains focus");
    assert.equal(during.value, "UNCOMMITTED-LOCAL-TEXT");
    await a.page.locator("#kolTable").focus();
    await B.settle(a);
    await a.page.waitForFunction(
      () =>
        document.querySelector('.editCell[data-id=\"2\"][data-k=\"modelKod\"]')
          .value === "PEER-OTHER-ROW",
    );
    const c = await B.cookie(a),
      w = R.check(
        await R.api(a.server, "/api/collection-workspaces/" + m.owner, {
          cookie: c,
        }),
      ).workspace;
    assert.equal(
      w.rows.find((r) => r.id === 1).modelKod,
      "UNCOMMITTED-LOCAL-TEXT",
    );
    assert.equal(w.rows.find((r) => r.id === 2).modelKod, "PEER-OTHER-ROW");
    await a.context.tracing.stop({
      path: R.path.join(root, "remote-editor-trace.zip"),
    });
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          source: m.source,
          during,
          rows: w.rows.map((r) => ({
            id: r.id,
            modelKod: r.modelKod,
            _rev: r._rev,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS actual unrelated remote edit preserves uncommitted focused text and later durable save",
    );
  } finally {
    await browser?.close();
    if (rt) for (const s of rt.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
