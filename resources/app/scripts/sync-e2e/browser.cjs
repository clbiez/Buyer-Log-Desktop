"use strict";
const R = require("./runtime.cjs"),
  { chromium } = require(
    process.env.BUYER_LOG_PLAYWRIGHT_MODULE || "playwright",
  );
async function cookie(session) {
  return (await session.context.cookies(session.server.base))
    .map((c) => c.name + "=" + c.value)
    .join("; ");
}
async function launch() {
  const browser=await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const fs=require('node:fs'),path=require('node:path'),moduleName=process.env.BUYER_LOG_PLAYWRIGHT_MODULE||'playwright';
  const packageFile=require.resolve(moduleName+'/package.json'),driver=JSON.parse(fs.readFileSync(packageFile,'utf8'));
  const coreFile=require.resolve('playwright-core/package.json',{paths:[path.dirname(packageFile)]});
  const expected=JSON.parse(fs.readFileSync(path.join(path.dirname(coreFile),'browsers.json'),'utf8')).browsers.find(x=>x.name==='chromium').browserVersion;
  const actual=browser.version(),branch=x=>String(x).split('.').slice(0,3).join('.');
  const metadata={playwright:driver.version,browser:actual,expectedChromium:expected,matchingBranch:branch(actual)===branch(expected),exactPatch:actual===expected,executable:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'};
  if(!metadata.matchingBranch){await browser.close();throw Error('Test browser/tool mismatch: '+JSON.stringify(metadata)+'. Select a matching Playwright module using BUYER_LOG_PLAYWRIGHT_MODULE.');}
  browser.__buyerLogToolchain=metadata;process.stdout.write('BROWSER_TOOLCHAIN '+JSON.stringify(metadata)+'\n');
  return browser;
}
async function open(
  browser,
  server,
  account,
  owner,
  { context = null, trace = false } = {},
) {
  context =
    context ||
    (await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    }));
  if (trace)
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
  const result = await context.request.post(server.base + "/api/user-login", {
    data: { userId: account.id, password: R.password, newPassword: R.password },
  });
  if (result.status() !== 200)
    throw Error(
      "browser login " + result.status() + " " + (await result.text()),
    );
  await context.addInitScript(
    ({ owner }) => {
      localStorage.setItem("bl.releaseNotes.lastSeenStable.v1", "99.0.0");
      localStorage.setItem(
        "lcw.koleksiyon.scope.v1",
        JSON.stringify({ ownerIds: [owner] }),
      );
    },
    { owner },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(server.base, { waitUntil: "domcontentloaded" });
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
  if (await page.locator("[data-rn-summary-close]").isVisible())
    await page.locator("[data-rn-summary-close]").click();
  await page.evaluate(() => switchTab("koleksiyon"));
  await page.locator("#kolAddRowBtn").waitFor();
  await page.waitForFunction(
    () =>
      kolWorkspaceList.length &&
      kolBaseline?.ownerId === kolWorkspaceOwnerId &&
      !kolWorkspaceSaving,
    null,
    { timeout: 30000 },
  );
  await page.evaluate(async (owner) => {
    await kolLoadWorkspaceBatch([owner]);
  }, owner);
  await page.waitForFunction((owner) => kolWorkspaceOwnerId === owner, owner);
  return {
    id: require("node:crypto").randomUUID(),
    context,
    page,
    server,
    account,
    owner,
    operations: [],
    responses: [],
    errors: [],
  };
}
function instrument(session, write) {
  const { page } = session;
  session.network = { requestBytes: 0, responseBytes: 0, completedRequests: 0 };
  page.on("requestfinished", async (request) => {
    try {
      const size = await request.sizes();
      session.network.requestBytes +=
        size.requestBodySize + size.requestHeadersSize;
      session.network.responseBytes +=
        size.responseBodySize + size.responseHeadersSize;
      session.network.completedRequests++;
    } catch {}
  });
  page.on("pageerror", (error) => {
    session.errors.push(error.message);
    write({
      type: "page-error",
      user: session.account.id,
      error: error.message,
    });
  });
  page.on("response", async (response) => {
    if (
      /\/api\/(pricing-rules|transit-rules|fx)(\?|$)/.test(response.url()) &&
      response.request().method() !== "GET"
    ) {
      try {
        write({
          type: "rule-response",
          user: session.account.id,
          status: response.status(),
          url: new URL(response.url()).pathname,
          data: await response.json(),
        });
      } catch {}
    }
  });
  page.on("request", (request) => {
    if (
      request.url().includes("/api/collection-workspaces/") &&
      ["PATCH", "PUT"].includes(request.method())
    ) {
      const op = session.currentOp;
      let body;
      try {
        body = request.postDataJSON();
      } catch {}
      const entry = {
        type: "submitted",
        requestId:require("node:crypto").randomUUID(),
        sessionId:session.id,
        operationId: op?.id || "native-"+require("node:crypto").randomUUID(),
        user: session.account.id,
        backend: session.server.port,
        url: new URL(request.url()).pathname,
        method: request.method(),
        body,
        at: Date.now(),
      };
      write(entry);
      request.__operationId = entry.operationId;
      request.__requestId = entry.requestId;
    }
  });
  page.on("response", async (response) => {
    const request = response.request();
    if (
      request.url().includes("/api/collection-workspaces/") &&
      ["PATCH", "PUT"].includes(request.method())
    ) {
      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = { readError: e.message };
      }
      const entry = {
        type: "server-response",
        operationId: request.__operationId,
        requestId:request.__requestId,sessionId:session.id,
        user: session.account.id,
        status: response.status(),
        data,
        at: Date.now(),
      };
      session.responses.push(entry);
      write(entry);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.__operationId)
      write({
        type: "transport-failed",
        operationId: request.__operationId,
        requestId:request.__requestId,sessionId:session.id,
        error: request.failure()?.errorText,
        at: Date.now(),
      });
  });
}
async function onceRoute(page, pattern, handle, options = {}) {
  const method =
    options.method || (pattern.includes("pricing-rules") ? "PUT" : "PATCH");
  let claimed = false;
  const handler = async (route) => {
    if (claimed || route.request().method() !== method) return route.continue();
    claimed = true;
    try {
      await handle(route);
    } catch (error) {
      (page.__proxyErrors ??= []).push(error.stack);
      await route.abort("failed").catch(() => {});
    } finally {
      await page.unroute(pattern, handler).catch(() => {});
    }
  };
  await page.route(pattern, handler);
}
async function edit(session, id, value, field = "modelKod") {
  const { page } = session;
  const target = page
    .locator(`#kolTable .editCell[data-id="${id}"][data-k="${field}"]`)
    .first();
  await target.fill(value);
  await target.press("Tab");
  return settle(session);
}
async function settle(session) {
  if (session.page.__proxyErrors?.length)
    throw Error(session.page.__proxyErrors.join("\n"));
  await session.page.waitForFunction(
    () => !kolWorkspaceSaveTimer && !kolWorkspaceSaving && !kolWorkspacePending,
    null,
    { timeout: 45000 },
  );
  return session.page.evaluate(() => ({
    dirty: kolHasDirtyWorkspace(),
    feedback: kolSaveFeedbackByOwner.get(kolWorkspaceOwnerId),
    revision: kolWorkspaceRevision,
    pending: kolReadPendingWorkspace(kolWorkspaceOwnerId),
    ui: document.getElementById("kolSaveState")?.innerText,
  }));
}
async function snapshot(session, id) {
  return session.page.evaluate((id) => {
    const row = kolRows.find((r) => String(r.id) === String(id));
    return {
      row: row ? JSON.parse(JSON.stringify(row)) : null,
      revision: kolWorkspaceRevision,
      feedback: kolSaveFeedbackByOwner.get(kolWorkspaceOwnerId),
      dirty: kolHasDirtyWorkspace(),
    };
  }, id);
}
async function calculate(session, id) {
  const start = Date.now(),
    p = session.page;
  const trigger=p.locator(`[data-kol-drawer-open="${id}"]`).first();
  // Center the row in the actual scroll viewport: native nearest scrolling can
  // leave a bottom row underneath the table's sticky totals/footer.
  await trigger.evaluate(el=>el.scrollIntoView({block:"center",inline:"center"}));
  await trigger.click();
  await p.locator(".cpdDrawer").waitFor();
  const out = await p.evaluate((id) => {
    const row = kolRows.find((r) => String(r.id) === String(id));
    return {
      lineage: BLPriceLineageBridge.snapshot(row, "collection", {}),
      landed: kolLandedCalc(row),
      pricingRules: state.overrides.pricingRules,
      pricingRevision: state.storeRevisions.pricingRules,
      fx: BLFX.store,
      drawer: document.querySelector(".cpdDrawer").innerText,
    };
  }, id);
  await p.evaluate(() => BLCollectionPriceDrawer.close());
  return { ...out, elapsedMs: Date.now() - start };
}
async function recoverAccepted(session,record=()=>{}){
  const p=session.page;await p.locator('#kolTable').focus();let state=await settle(session);
  const button=p.locator('[data-kol-server-recovery]');
  if(!await button.isVisible())return {attempted:false,...state};
  const accept=dialog=>dialog.accept();p.once('dialog',accept);
  try{await button.click();await p.waitForFunction(()=>!kolWorkspaceRecoveryOwnerId,null,{timeout:35000});}
  finally{p.off('dialog',accept);}
  state=await settle(session);record({type:'explicit-server-recovery',user:session.account.id,sessionId:session.id,parentOperationId:session.currentOp?.id,result:state});
  return {attempted:true,...state};
}
module.exports = {
  cookie,
  onceRoute,
  launch,
  open,
  instrument,
  edit,
  settle,
  snapshot,
  calculate,
  recoverAccepted,
};
