"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  B = require("../../../resources/app/scripts/sync-e2e/browser.cjs"),
  assert = require("node:assert/strict");
const root = process.argv[2] || "/workspace/scratch/bl-active-restart";
let rt, browser, release;
(async () => {
  try {
    rt = await R.setup(root, { users: 2, backends: 2, port: 6610 });
    await R.stopServer(rt.servers[0]);
    rt.servers[0] = await R.startServer(
      R.path.join(root, "device-0"),
      rt.manifest.port,
      rt.manifest.hub,
      R.path.join(__dirname, "watchdog-entry.cjs"),
    );
    browser = await B.launch();
    const m = rt.manifest,
      a = await B.open(browser, rt.servers[0], m.accounts[0], m.owner, {
        trace: true,
      }),
      b = await B.open(browser, rt.servers[1], m.accounts[1], m.owner),
      log = (x) =>
        R.fs.appendFileSync(
          R.path.join(root, "operations.jsonl"),
          JSON.stringify({ at: Date.now(), ...x }) + "\n",
        );
    B.instrument(a, log);
    B.instrument(b, log);
    let acceptedResolve;
    const acceptedGate = new Promise((r) => (acceptedResolve = r)),
      hold = new Promise((r) => (release = r));
    await B.onceRoute(
      a.page,
      "**/api/collection-workspaces/*",
      async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        log({
          type: "upstream-acceptance",
          operationId: "restart-write",
          status: response.status(),
          data,
        });
        acceptedResolve(data);
        await hold;
        await route.abort("connectionreset");
      },
    );
    a.currentOp = { id: "restart-write" };
    const sending = B.edit(a, 1, "ACK-THEN-RESTART");
    const accepted = await R.deadline(
      acceptedGate,
      "actual accepted response before restart",
    );
    assert.ok(accepted.applied.some((x) => x.id === "1"));
    const stoppedAt = Date.now();
    const runtimeFile = R.path.join(
        root,
        "device-0/localappdata/BuyerLog/runtime/watchdog.json",
      ),
      previous = JSON.parse(R.fs.readFileSync(runtimeFile)),
      logOffset = R.fs.statSync(R.path.join(root, "device-0/server.log")).size;
    process.kill(previous.serverPid, "SIGKILL");
    b.currentOp = { id: "other-backend-during-restart" };
    await B.edit(b, 2, "OTHER-DEVICE-ACTIVE");
    release();
    const failed = await sending;
    assert.equal(failed.dirty, true);
    const restarted = rt.servers[0];
    await R.until(
      async () => {
        const current = JSON.parse(R.fs.readFileSync(runtimeFile));
        if (!current.serverPid || current.serverPid === previous.serverPid)
          return false;
        const suffix = R.fs
          .readFileSync(R.path.join(root, "device-0/server.log"), "utf8")
          .slice(logOffset);
        return (
          suffix.includes("SERVER_READY") &&
          (await R.api(restarted, "/api/auth-status")).status === 200
        );
      },
      {
        ms: 25000,
        label: "real watchdog automatically restarted killed backend",
      },
    );
    const readyAt = Date.now();
    const retry = await a.page.evaluate(async () => {
      const r = await kolSaveWorkspaceNow();
      return { ok: r.ok, pending: Boolean(r.pending) };
    });
    log({ type: "application-retry", operationId: "restart-write", retry });
    assert.equal(retry.ok, true);
    assert.equal(retry.pending, false);
    const settled = await B.settle(a);
    assert.equal(settled.dirty, false);
    assert.notEqual(settled.feedback?.status, "failed");
    await a.page.locator("#kolTable").focus();
    await a.page.waitForFunction(() => liveSyncConnected === true, null, {
      timeout: 20000,
    });
    await R.until(
      async () => {
        const c = await B.cookie(a),
          w = R.check(
            await R.api(restarted, "/api/collection-workspaces/" + m.owner, {
              cookie: c,
            }),
          ).workspace;
        return (
          w.rows.find((r) => r.id === 2).modelKod === "OTHER-DEVICE-ACTIVE"
        );
      },
      { ms: 15000, label: "other device state after restart" },
    );
    await a.page.waitForFunction(
      () =>
        document.querySelector('.editCell[data-id="2"][data-k="modelKod"]')
          .value === "OTHER-DEVICE-ACTIVE",
      null,
      { timeout: 20000 },
    );
    for (const s of [a, b]) {
      await s.page.locator("#kolTable").focus();
      await s.page.waitForFunction(
        () =>
          document.querySelector(
            '.editCell[data-id=\"1\"][data-k=\"modelKod\"]',
          ).value === "ACK-THEN-RESTART" &&
          document.querySelector(
            '.editCell[data-id=\"2\"][data-k=\"modelKod\"]',
          ).value === "OTHER-DEVICE-ACTIVE",
        null,
        { timeout: 20000 },
      );
      const cookie = await B.cookie(s),
        w = R.check(
          await R.api(s.server, "/api/collection-workspaces/" + m.owner, {
            cookie,
          }),
        ).workspace;
      assert.equal(w.rows.length, 2);
      assert.equal(w.rows.find((r) => r.id === 1).modelKod, "ACK-THEN-RESTART");
      assert.equal(
        w.rows.find((r) => r.id === 2).modelKod,
        "OTHER-DEVICE-ACTIVE",
      );
    }
    await a.page.screenshot({
      path: R.path.join(root, "active-restart-recovered.png"),
    });
    await a.context.tracing.stop({
      path: R.path.join(root, "active-restart-trace.zip"),
    });
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          source: m.source,
          browserContexts: 2,
          backends: 2,
          replicas: 2,
          accepted,
          failed,
          retry,
          backendUnavailableMs: readyAt - stoppedAt,
          recoveryThroughDomMs: Date.now() - stoppedAt,
          otherBackendContinued: true,
          supervision:
            "real server/watchdog.js, child SIGKILL, same in-memory supervisor key",
          reauthentication: false,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS post-acceptance response loss, active backend restart, other device continues, application retry and actual DOM convergence",
    );
  } finally {
    release?.();
    await browser?.close();
    if (rt) for (const s of rt.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
