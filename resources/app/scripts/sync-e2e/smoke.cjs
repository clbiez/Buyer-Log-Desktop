"use strict";
const R = require("./runtime.cjs"),
  B = require("./browser.cjs"),
  assert = require("node:assert/strict");
(async () => {
  const root =
    process.argv[2] ||
    R.fs.mkdtempSync(R.path.join(R.os.tmpdir(), "bl-ui-smoke-"));
  let runtime, browser;
  const ledger = [];
  const write = (x) => {
    ledger.push(x);
    R.fs.appendFileSync(
      R.path.join(root, "ledger.jsonl"),
      JSON.stringify(x) + "\n",
    );
  };
  try {
    runtime = await R.setup(root, { users: 2, backends: 2 });
    browser = await B.launch();
    const { servers, manifest: m } = runtime;
    const a = await B.open(browser, servers[0], m.accounts[0], m.owner, {
      trace: true,
    });
    const b = await B.open(browser, servers[1], m.accounts[1], m.owner);
    B.instrument(a, write);
    B.instrument(b, write);
    a.currentOp = { id: "smoke-edit-1" };
    const state = await B.edit(a, 1, "smoke-edit-1");
    console.log("EDIT", state);
    assert.equal(state.dirty, false);
    await R.until(
      async () => (await B.snapshot(b, 1)).row?.modelKod === "smoke-edit-1",
      { ms: 30000, label: "replica UI convergence" },
    );
    const calc = await B.calculate(a, 1);
    write({ type: "calculation", ...calc });
    console.log("CALC", JSON.stringify(calc.lineage));
    await a.page.screenshot({ path: R.path.join(root, "ui.png") });
    await a.context.tracing.stop({ path: R.path.join(root, "trace.zip") });
    console.log(
      "PASS UI edit, durable ACK, second backend UI convergence, native calculation",
      root,
    );
  } finally {
    await browser?.close();
    if (runtime) for (const s of runtime.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
