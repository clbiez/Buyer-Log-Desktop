"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  B = require("../../../resources/app/scripts/sync-e2e/browser.cjs");
let rt, browser;
(async () => {
  try {
    rt = await R.attach(process.argv[2]);
    browser = await B.launch();
    const s = await B.open(
      browser,
      rt.servers[0],
      rt.manifest.accounts[0],
      rt.manifest.owner,
    );
    await s.page.locator("#kolTable").focus();
    await B.settle(s);
    await s.page
      .locator('.editCell[data-id=\"1\"][data-k=\"modelKod\"]')
      .scrollIntoViewIfNeeded();
    await s.page.screenshot({
      path: R.path.join(process.argv[2], "cold-ui-accepted.png"),
    });
    console.log(
      "CAPTURE",
      await s.page
        .locator('.editCell[data-id="1"][data-k="modelKod"]')
        .inputValue(),
    );
  } finally {
    await browser?.close();
    if (rt) for (const s of rt.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
