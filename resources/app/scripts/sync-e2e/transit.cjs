"use strict";
const R = require("./runtime.cjs"),
  B = require("./browser.cjs"),
  assert = require("node:assert/strict");
(async () => {
  const root = R.path.resolve(process.argv[2]);
  R.fs.mkdirSync(root, { recursive: true });
  let server, browser;
  try {
    server = await R.startServer(
      R.path.join(root, "device"),
      6550,
      null,
      R.path.join(__dirname, "transit-entry.cjs"),
    );
    browser = await B.launch();
    const s = await B.open(
        browser,
        server,
        { id: "moderator", index: 0 },
        "moderator",
        { trace: true },
      ),
      cookie = await B.cookie(s);
    await s.page.evaluate(() => switchTab("cp"));
    await s.page.waitForFunction(() => state.cp?.rows?.length === 1);
    const before = await s.page.evaluate(() => state.cp.rows[0]);
    R.fs.writeFileSync(
      R.path.join(root, "before.json"),
      JSON.stringify(before, null, 2),
    );
    await s.page.evaluate(() => openTransitRulesModal());
    await s.page.locator("#_transitDays").fill("31");
    await s.page.locator("#_transitAdd").click();
    await s.page.locator("#_transitSave").click();
    await s.page.locator("#_transitSave").waitFor({ state: "detached" });
    const actual = await s.page.evaluate(() => ({
      row: state.cp.rows[0],
      revision: state.storeRevisions.transitRules,
      resolved: resolveTransitDaysForValues(
        "Gemi",
        "2026-11-01",
        "W26",
        "China",
        "Üretimde",
      ),
      nonProduction: resolveTransitDaysForValues(
        "Gemi",
        "2026-11-01",
        "W26",
        "China",
        "Yolda",
      ),
    }));
    const durable = R.check(
        await R.api(server, "/api/transit-rules", { cookie }),
      ),
      projection = R.check(await R.api(server, "/api/data/cp", { cookie }));
    assert.equal(actual.resolved.days, 31);
    assert.equal(actual.nonProduction.days, 70);
    assert.equal(actual.revision, durable.revision);
    const expected = new Date(Date.UTC(2026, 10, 1) + 31 * 86400000)
      .toISOString()
      .slice(0, 10);
    assert.equal(
      (actual.row["Ant. Arrival"] instanceof Date
        ? actual.row["Ant. Arrival"].toISOString()
        : String(actual.row["Ant. Arrival"])
      ).slice(0, 10),
      expected,
    );
    assert.equal(
      String(projection.rows[0]["Ant. Arrival"]).slice(0, 10),
      expected,
    );
    await s.page.screenshot({ path: R.path.join(root, "transit-after.png") });
    await s.context.tracing.stop({ path: R.path.join(root, "trace.zip") });
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(
        { status: "passed", before, actual, durable, projection, expected },
        null,
        2,
      ),
    );
    console.log(
      "PASS native CP order transit rule, date arithmetic, non-production exception and real API parity",
      root,
    );
  } finally {
    await browser?.close();
    await R.stopServer(server);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
