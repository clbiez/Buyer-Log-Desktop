"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  B = require("../../../resources/app/scripts/sync-e2e/browser.cjs"),
  assert = require("node:assert/strict");
const root = process.argv[2] || "/workspace/scratch/bl-shared-crud";
let rt, browser;
(async () => {
  try {
    rt = await R.setup(root, { users: 3, backends: 2, port: 6580 });
    browser = await B.launch();
    const m = rt.manifest,
      a = await B.open(browser, rt.servers[0], m.accounts[1], m.owner, {
        trace: true,
      }),
      peer = await B.open(browser, rt.servers[1], m.accounts[0], m.owner),
      log = (x) =>
        R.fs.appendFileSync(
          R.path.join(root, "operations.jsonl"),
          JSON.stringify({ at: Date.now(), ...x }) + "\n",
        );
    for (const s of [a, peer]) B.instrument(s, log);
    a.currentOp = { id: "shared-create-20261025" };
    await a.page.locator("#kolAddRowBtn").click();
    const id = await a.page.evaluate(() => kolRows[0].id);
    await B.edit(a, id, "SHARED-UI-CREATE");
    await a.page.locator("#kolTable").focus();
    const cookie = await B.cookie(peer);
    await R.until(
      async () => {
        const w = R.check(
          await R.api(peer.server, "/api/collection-workspaces/" + m.owner, {
            cookie,
          }),
        ).workspace;
        return w.rows.some(
          (r) =>
            String(r.id) === String(id) && r.modelKod === "SHARED-UI-CREATE",
        );
      },
      { ms: 15000, label: "created row delivered to independent backend" },
    );
    await peer.page.waitForFunction(
      (id) =>
        kolRows.some(
          (r) =>
            String(r.id) === String(id) && r.modelKod === "SHARED-UI-CREATE",
        ),
      id,
      { timeout: 15000 },
    );
    await peer.page
      .locator('.editCell[data-id=\"' + id + '\"][data-k=\"modelKod\"]')
      .scrollIntoViewIfNeeded();
    await peer.page.screenshot({
      path: R.path.join(root, "shared-created-peer.png"),
    });
    a.currentOp = { id: "shared-delete-20261025" };
    await a.page.locator('#kolTable .rowChk[data-id="' + id + '"]').check();
    await a.page.locator("#kolDelRowBtn").click();
    await a.page.locator("#_kolSelectedActionConfirm [data-confirm]").click();
    await B.settle(a);
    await R.until(
      async () => {
        const w = R.check(
          await R.api(peer.server, "/api/collection-workspaces/" + m.owner, {
            cookie,
          }),
        ).workspace;
        return !w.rows.some((r) => String(r.id) === String(id));
      },
      { ms: 15000, label: "deletion delivered to independent backend" },
    );
    await peer.page.waitForFunction(
      (id) => !kolRows.some((r) => String(r.id) === String(id)),
      id,
      { timeout: 15000 },
    );
    const auth = await B.cookie(a),
      bin = R.check(
        await R.api(a.server, "/api/collection-recycle-bin/" + m.owner, {
          cookie: auth,
        }),
      );
    assert.equal(
      bin.entries.filter(
        (x) =>
          String(x.row?.id) === String(id) &&
          x.row.modelKod === "SHARED-UI-CREATE",
      ).length,
      1,
    );
    await a.context.tracing.stop({
      path: R.path.join(root, "shared-crud-trace.zip"),
    });
    await browser.close();
    browser = null;
    for (const s of rt.servers) await R.stopServer(s);
    const cold = [];
    for (let i = 0; i < rt.servers.length; i++) {
      const s = await R.startServer(
        R.path.join(root, "device-" + i),
        m.port + i,
        m.hub,
      );
      rt.servers[i] = s;
      const c = await R.login(s, m.accounts[0].id),
        w = R.check(
          await R.api(s, "/api/collection-workspaces/" + m.owner, {
            cookie: c,
          }),
        ).workspace;
      assert.equal(w.rows.length, 3);
      assert.equal(
        w.rows.some((r) => String(r.id) === String(id)),
        false,
      );
      cold.push({
        backend: s.port,
        revision: w._revision,
        rowCount: w.rows.length,
        manufacturers: w.manufacturers,
      });
    }
    const result = {
      status: "passed",
      source: m.source,
      users: 2,
      browserContexts: 2,
      backends: 2,
      replicas: 2,
      owner: m.owner,
      createdDeletedRow: id,
      archiveCopies: 1,
      cold,
    };
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser?.close();
    if (rt) for (const s of rt.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
