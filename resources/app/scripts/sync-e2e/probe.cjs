"use strict";
const R = require("./runtime.cjs");
const { chromium } = require(
  process.env.BUYER_LOG_PLAYWRIGHT_MODULE || "playwright",
);
(async () => {
  const root =
    process.argv[2] ||
    R.fs.mkdtempSync(R.path.join(R.os.tmpdir(), "bl-sync-probe-"));
  let runtime, browser;
  try {
    runtime = await R.setup(root, { users: 2, backends: 2 });
    console.log("SETUP", root);
    browser = await chromium.launch({
      headless: true,
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    await page.goto(runtime.servers[0].base);
    await page.locator("#username").fill(runtime.manifest.accounts[0].username);
    await page.locator("#suggestions button").first().click();
    await page.locator("#password").fill(R.password);
    await page.locator("#loginBtn").click();
    await page.waitForFunction(() => typeof switchTab === "function", null, {
      timeout: 90000,
    });
    await page.waitForFunction(
      () =>
        !document.getElementById("blBootGuard") ||
        document.querySelector("[data-boot-continue]"),
      null,
      { timeout: 90000 },
    );
    if (await page.locator("[data-boot-continue]").count())
      await page.locator("[data-boot-continue]").click();
    await page.waitForFunction(
      () => !document.getElementById("blBootGuard"),
      null,
      { timeout: 90000 },
    );
    await page.evaluate(() => {
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      switchTab("koleksiyon");
    });
    await page.locator("#kolAddRowBtn").waitFor();
    await page.waitForFunction(
      () => typeof kolRows !== "undefined" && kolRows.length === 2,
    );
    console.log(
      "STATE",
      await page.evaluate(() => ({
        owner: kolWorkspaceOwnerId,
        rows: kolRows,
        canEdit: kolWorkspaceCanEdit,
        fields: [...document.querySelectorAll("#kolTable .editCell")]
          .map((e) => ({ k: e.dataset.k, id: e.dataset.id }))
          .slice(0, 18),
      })),
    );
    await page.screenshot({ path: R.path.join(root, "probe.png") });
  } finally {
    await browser?.close();
    if (runtime) for (const s of runtime.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
