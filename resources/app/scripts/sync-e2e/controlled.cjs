"use strict";
const R = require("./runtime.cjs"),
  B = require("./browser.cjs"),
  assert = require("node:assert/strict");
const root = R.path.resolve(
    process.argv[2] || "/workspace/scratch/bl-controlled",
  ),
  results = [];
let rt, browser, a, b, c;
R.fs.mkdirSync(root, { recursive: true });
const log = (x) =>
  R.fs.appendFileSync(
    R.path.join(root, "evidence.jsonl"),
    JSON.stringify({ at: Date.now(), ...x }) + "\n",
  );
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => (resolve = r)),
    resolve: (v) => resolve(v),
  };
};
async function barrier(s) {
  const entered = deferred(),
    release = deferred();
  await B.onceRoute(
    s.page,
    "**/api/collection-workspaces/*",
    async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      entered.resolve(route.request().postDataJSON());
      await release.promise;
      await route.continue();
    },
    { times: 1 },
  );
  return { entered: entered.promise, release: release.resolve };
}
async function reset(s) {
  await s.page.evaluate(async (owner) => {
    kolClearPendingWorkspace(owner);
    await kolLoadWorkspace(owner);
  }, rt.manifest.owner);
  s.currentOp = null;
}
async function scenario(name, fn) {
  if (
    process.env.BL_E2E_SCENARIOS &&
    !new RegExp(process.env.BL_E2E_SCENARIOS).test(name)
  )
    return;
  try {
    const data = await fn();
    results.push({ name, status: "passed", data });
    log({ type: "scenario", name, status: "passed", data });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "failed", error: e.stack });
    log({ type: "scenario", name, status: "failed", error: e.stack });
    console.error("FAIL", name, e.message);
    if (name.startsWith("review-offline"))
      R.fs.writeFileSync(
        R.path.join(root, "draft-recovery-writes.json"),
        JSON.stringify(
          await a.page
            .evaluate(() => ({
              writes: window.__draftRecoveryWrites,
              owner: kolWorkspaceOwnerId,
              pref: BLStorage.getItem(KOL_SCOPE_PREF_KEY),
              rows: kolRows,
              pending: kolReadPendingWorkspace(kolWorkspaceOwnerId),
            }))
            .catch(() => ({})),
          null,
          2,
        ),
      );
    await a?.page
      .screenshot({ path: R.path.join(root, name + "-failure.png") })
      .catch(() => {});
  } finally {
    for (const s of [a, b, c].filter(Boolean)) await reset(s).catch(() => {});
  }
}
(async () => {
  try {
    rt = await R.setup(root, {
      users: 3,
      backends: 2,
      port: Number(process.env.BL_E2E_PORT || 6530),
    });
    browser = await B.launch();
    const m = rt.manifest,
      s0 = rt.servers[0],
      s1 = rt.servers[1],
      mod = await R.login(s0);
    a = await B.open(browser, s0, m.accounts[1], m.owner, { trace: true });
    b = await B.open(browser, s0, m.accounts[2], m.owner);
    c = await B.open(browser, s1, m.accounts[0], m.owner);
    for (const s of [a, b, c]) B.instrument(s, log);
    await scenario("same-field-row-CAS", async () => {
      const ga = await barrier(a),
        gb = await barrier(b);
      a.currentOp = { id: "race-a" };
      b.currentOp = { id: "race-b" };
      const pa = B.edit(a, 1, "RACE-A"),
        pb = B.edit(b, 1, "RACE-B");
      const bodies = await Promise.all([ga.entered, gb.entered]);
      ga.release();
      await pa;
      gb.release();
      const rejected = await pb;
      assert.equal(rejected.dirty, true);
      assert.equal(rejected.feedback.status, "conflict");
      const current = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      assert.equal(current.rows.find((r) => r.id === 1).modelKod, "RACE-A");
      // Replay a legitimate remote reload notification after the rejection.
      // No server acceptance or calculation response is fabricated.
      await b.page.evaluate(
        (owner) => kolHandleRemoteChange(owner, { mode: "reload" }),
        m.owner,
      );
      const afterRemote = await B.settle(b);
      assert.equal(afterRemote.feedback.status, "conflict");
      assert.doesNotMatch(
        afterRemote.ui,
        /Bu cihazda kaydedildi|Saved on this device/,
      );
      await b.page.screenshot({
        path: R.path.join(root, "rejected-save-not-saved.png"),
      });
      return { bodies, rejected, afterRemote };
    });
    await scenario("different-fields-same-row-CAS", async () => {
      const ga = await barrier(a),
        gb = await barrier(b);
      const pa = B.edit(a, 2, "MODEL-A"),
        pb = B.edit(b, 2, "SPECIAL-B", "specialCode");
      await Promise.all([ga.entered, gb.entered]);
      ga.release();
      await pa;
      gb.release();
      const r = await pb;
      assert.equal(r.dirty, true);
      assert.equal(r.feedback.status, "conflict");
      return {
        policy:
          "row CAS rejects stale edits even for different fields on one backend",
        rejected: r,
      };
    });
    await scenario("delete-before-stale-save", async () => {
      const ga = await barrier(a),
        pa = B.edit(a, 3, "SHOULD-NOT-RESURRECT");
      const sent = await ga.entered;
      const before = R.check(
          await R.api(s0, "/api/collection-workspaces/" + m.owner, {
            cookie: mod,
          }),
        ).workspace,
        row = before.rows.find((r) => r.id === 3);
      const deletion = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          method: "PATCH",
          cookie: mod,
          body: { deletes: [{ id: 3, _rev: row._rev }] },
        }),
      );
      ga.release();
      const stale = await pa;
      assert.equal(stale.dirty, true);
      assert.equal(stale.feedback.status, "conflict");
      assert.ok(
        stale.pending.rows.find((r) => r.id === 3),
        "draft survives rejection",
      );
      const after = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      assert.equal(
        after.rows.some((r) => r.id === 3),
        false,
      );
      await a.page.screenshot({
        path: R.path.join(root, "deleted-stale-conflict-tr.png"),
      });
      await a.page.evaluate(() => {
        appLang = "en";
        kolRenderSaveFeedback();
      });
      await a.page.screenshot({
        path: R.path.join(root, "deleted-stale-conflict-en.png"),
      });
      return { sent, deletion, stale };
    });
    await scenario("response-lost-after-durable-acceptance", async () => {
      await B.onceRoute(
        c.page,
        "**/api/collection-workspaces/*",
        async (route) => {
          if (route.request().method() !== "PATCH") return route.continue();
          const response = await route.fetch();
          log({
            type: "real-upstream-response",
            status: response.status(),
            data: await response.json(),
          });
          await route.abort("connectionreset");
        },
        { times: 1 },
      );
      c.currentOp = { id: "lost-ack" };
      const ui = await B.edit(c, 1, "LOST-ACK-ACCEPTED");
      assert.equal(ui.dirty, true);
      assert.equal(ui.feedback.status, "failed");
      const cookie = await R.login(s1, m.accounts[0].id),
        accepted = R.check(
          await R.api(s1, "/api/collection-workspaces/" + m.owner, { cookie }),
        ).workspace;
      assert.equal(
        accepted.rows.find((r) => r.id === 1).modelKod,
        "LOST-ACK-ACCEPTED",
      );
      const retry = await c.page.evaluate(async () => {
        const r = await kolSaveWorkspaceNow();
        return { ok: r.ok, pending: r.pending };
      });
      await B.settle(c);
      const after = R.check(
        await R.api(s1, "/api/collection-workspaces/" + m.owner, { cookie }),
      ).workspace;
      assert.equal(
        after.rows.filter((r) => r.modelKod === "LOST-ACK-ACCEPTED").length,
        1,
      );
      return { ui, retry, rows: after.rows.length };
    });
    await scenario("offline-before-send-and-refresh", async () => {
      await c.context.setOffline(true);
      const ui = await B.edit(c, 2, "OFFLINE-DRAFT");
      assert.equal(ui.dirty, true);
      assert.equal(ui.feedback.status, "failed");
      assert.ok(ui.pending);
      await c.context.setOffline(false);
      await c.page.reload({ waitUntil: "domcontentloaded" });
      await c.page.waitForFunction(
        () => typeof kolLoadWorkspace === "function",
      );
      await c.page.evaluate(async (owner) => {
        switchTab("koleksiyon");
        await kolLoadWorkspace(owner);
      }, m.owner);
      await c.page.waitForFunction(() =>
        kolRows.some((r) => r.modelKod === "OFFLINE-DRAFT"),
      );
      const r = await c.page.evaluate(async () => {
        const r = await kolSaveWorkspaceNow();
        return { ok: r.ok, pending: r.pending };
      });
      await B.settle(c);
      assert.equal(r.ok, true);
      return { ui, retry: r };
    });
    await scenario("review-offline-edit-peer-delete-refresh", async () => {
      const diagnostic = async (stage) =>
        log({
          type: "review-state",
          stage,
          state: await a.page.evaluate(() => ({
            owner: kolWorkspaceOwnerId,
            pref: BLStorage.getItem(KOL_SCOPE_PREF_KEY),
            rows: kolRows,
            baseline: kolBaseline
              ? {
                  ownerId: kolBaseline.ownerId,
                  rows: [...kolBaseline.rows.values()],
                  expectedExistingIds: [
                    ...(kolBaseline.expectedExistingIds || []),
                  ],
                  expectedNewIds: [...(kolBaseline.expectedNewIds || [])],
                }
              : null,
            pending: Object.fromEntries(
              Object.keys(localStorage)
                .filter((k) => k.startsWith("bl.collection.pending."))
                .map((k) => [k, JSON.parse(localStorage.getItem(k))]),
            ),
          })),
        });
      await a.page.evaluate(() => BLStorage.flushPending());
      await diagnostic("before-offline");
      await a.context.setOffline(true);
      const offline = await B.edit(a, 3, "OFFLINE-DELETED-DRAFT");
      assert.equal(offline.dirty, true);
      assert.equal(offline.pending.schemaVersion, 2);
      const before = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      const row = before.rows.find((r) => r.id === 3);
      R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          method: "PATCH",
          cookie: mod,
          body: {
            deletes: [{ id: 3, _rev: row._rev }],
            upserts: [{ id: 999, modelKod: "REMOTE-ONLY-ADDITION" }],
            expectedNewIds: ["999"],
          },
        }),
      );
      await diagnostic("draft-before-reload");
      await a.context.setOffline(false);
      await a.page.addInitScript(() => {
        window.__draftRecoveryWrites = [];
        for (const method of ["setItem", "removeItem"]) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (key, ...args) {
            if (
              String(key).startsWith("bl.collection.pending.") ||
              String(key).endsWith("lcw.koleksiyon.scope.v1")
            )
              window.__draftRecoveryWrites.push({
                method,
                key,
                value: args[0],
                stack: new Error().stack,
              });
            return original.call(this, key, ...args);
          };
        }
      });
      await a.page.reload({ waitUntil: "domcontentloaded" });
      await a.page.waitForFunction(
        () => typeof kolLoadWorkspace === "function",
      );
      await a.page.waitForFunction(
        (owner) =>
          kolWorkspaceOwnerId === owner && kolBaseline?.ownerId === owner,
        m.owner,
        { timeout: 30000 },
      );
      if (await a.page.locator("[data-boot-continue]").count())
        await a.page.locator("[data-boot-continue]").click();
      await a.page.waitForFunction(
        () => !document.getElementById("blBootGuard"),
      );
      await a.page.evaluate(() => switchTab("koleksiyon"));
      await diagnostic("boot-restored");
      R.fs.writeFileSync(
        R.path.join(root, "draft-recovery-writes.json"),
        JSON.stringify(
          await a.page.evaluate(() => window.__draftRecoveryWrites),
          null,
          2,
        ),
      );
      const restored = await a.page.evaluate(() => ({
        rows: kolRows,
        dirty: kolHasDirtyWorkspace(),
      }));
      assert.ok(
        restored.rows.find((r) => r.id === 999),
        "unrelated peer addition remains visible",
      );
      const result = await a.page.evaluate(async () => {
        const r = await kolSaveWorkspaceNow();
        return { ok: r.ok, pending: r.pending };
      });
      const after = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      assert.equal(
        after.rows.some((r) => r.id === 3),
        false,
        "deleted row is never resurrected",
      );
      assert.equal(
        after.rows.find((r) => r.id === 999).modelKod,
        "REMOTE-ONLY-ADDITION",
      );
      await diagnostic("after-retry");
      const state = await a.page.evaluate(() => ({
        rows: kolRows,
        dirty: kolHasDirtyWorkspace(),
        feedback: kolSaveFeedbackByOwner.get(kolWorkspaceOwnerId),
        pending: kolReadPendingWorkspace(kolWorkspaceOwnerId),
      }));
      assert.equal(state.dirty, true);
      assert.equal(state.feedback.status, "conflict");
      assert.ok(
        state.pending.rows.find(
          (r) => r.id === 3 && r.modelKod === "OFFLINE-DELETED-DRAFT",
        ),
      );
      await a.page.screenshot({
        path: R.path.join(root, "offline-deleted-draft-preserved.png"),
      });
      return { offline, restored, result, state, durable: after };
    });
    await scenario("review-focused-editor-defers-reload", async () => {
      await B.settle(a);
      await a.page
        .locator('.editCell[data-id="1"][data-k="modelKod"]')
        .first()
        .focus();
      let reads = 0;
      const onRequest = (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname ===
            "/api/collection-workspaces/" + m.owner
        )
          reads++;
      };
      a.page.on("request", onRequest);
      const current = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          method: "PATCH",
          cookie: mod,
          body: {
            baseRevision: current._revision,
            structure: {
              order: current.rows.map((r) => String(r.id)).reverse(),
              customColumns: current.customColumns,
              manufacturers: current.manufacturers,
              statusCatalog: current.statusCatalog,
            },
          },
        }),
      );
      await a.page.waitForFunction(
        (owner) => kolRemoteReloadPendingOwner === owner,
        m.owner,
        { timeout: 10000 },
      );
      await R.delay(1100);
      assert.equal(reads, 0, "focused editor must not poll the full workspace");
      await a.page.locator("#kolSearch").focus();
      await R.until(() => reads > 0, {
        ms: 10000,
        label: "focusout resumes one deferred reload",
      });
      await a.page.waitForFunction(() => !kolRemoteReloadPendingOwner);
      a.page.off("request", onRequest);
      await a.page.screenshot({
        path: R.path.join(root, "focused-editor-deferred-reload.png"),
      });
      return {
        readsWhileFocused: 0,
        readsAfterFocusout: reads,
        observationMs: 1100,
      };
    });
    await scenario("same-user-two-tabs", async () => {
      const tab = await B.open(browser, s0, m.accounts[1], m.owner, {
        context: a.context,
      });
      B.instrument(tab, log);
      try {
        await reset(a);
        const ga = await barrier(a),
          gt = await barrier(tab),
          pa = B.edit(a, 2, "TAB-A"),
          pt = B.edit(tab, 2, "TAB-B");
        await Promise.all([ga.entered, gt.entered]);
        ga.release();
        await pa;
        gt.release();
        const r = await pt;
        assert.equal(r.dirty, true);
        assert.equal(r.feedback.status, "conflict");
        return { sameContext: true, conflict: r.feedback };
      } finally {
        await tab.page.close();
      }
    });
    await scenario("expired-client-session-rejects-save", async () => {
      await b.context.clearCookies();
      const ui = await B.edit(b, 1, "UNAUTHENTICATED");
      assert.equal(ui.dirty, true);
      assert.equal(ui.feedback.status, "failed");
      return {
        ui,
        limit:
          "Browser session cookie expiration/removal; real 12-hour signed-token expiry is not accelerated",
      };
    });
    await scenario("cross-owner-isolation", async () => {
      const cookie = await R.login(s0, m.accounts[2].id),
        foreign = await R.api(
          s0,
          "/api/collection-workspaces/" + m.accounts[1].id,
          { cookie },
        );
      assert.equal(foreign.status, 403);
      return { status: foreign.status };
    });

    await scenario("extra-cross-backend-different-fields", async () => {
      await reset(a);
      await reset(c);
      const ga = await barrier(a),
        gc = await barrier(c),
        pa = B.edit(a, 1, "CROSS-MODEL"),
        pc = B.edit(c, 1, "CROSS-SPECIAL", "specialCode");
      await Promise.all([ga.entered, gc.entered]);
      ga.release();
      gc.release();
      const receipts = await Promise.all([pa, pc]);
      const cookie = await R.login(s1, m.accounts[0].id);
      await R.until(
        async () => {
          for (const [server, auth] of [
            [s0, mod],
            [s1, cookie],
          ]) {
            const w = R.check(
                await R.api(server, "/api/collection-workspaces/" + m.owner, {
                  cookie: auth,
                }),
              ).workspace,
              r = w.rows.find((r) => r.id === 1);
            if (
              r?.modelKod !== "CROSS-MODEL" ||
              r?.specialCode !== "CROSS-SPECIAL"
            )
              return false;
          }
          return true;
        },
        { ms: 30000, label: "field merge across actual backends" },
      );
      await a.page.locator("#kolSearch").focus();
      await c.page.locator("#kolSearch").focus();
      await R.until(
        async () => {
          const row = (await B.snapshot(c, 1)).row;
          return (
            row?.modelKod === "CROSS-MODEL" &&
            row?.specialCode === "CROSS-SPECIAL"
          );
        },
        { ms: 30000, label: "actual UI merged fields after editor leaves row" },
      );
      await c.page.screenshot({
        path: R.path.join(root, "cross-backend-field-merge.png"),
      });
      return { receipts };
    });
    await scenario("extra-real-ui-create-delete", async () => {
      await a.page.evaluate(
        async (owner) => kolLoadWorkspace(owner),
        a.account.id,
      );
      await a.page.locator("#kolAddRowBtn").click();
      const id = await a.page.evaluate(() => kolRows[0].id);
      await B.edit(a, id, "CREATE-DELETE-SYNTHETIC");
      await a.page.locator('#kolTable .rowChk[data-id="' + id + '"]').check();
      await a.page.locator("#kolDelRowBtn").click();
      await a.page.locator("#_kolSelectedActionConfirm [data-confirm]").click();
      await a.page.waitForFunction(
        (id) => !kolRows.some((r) => r.id === id),
        id,
      );
      await B.settle(a);
      const auth = await R.login(s0, a.account.id),
        w = R.check(
          await R.api(s0, "/api/collection-workspaces/" + a.account.id, {
            cookie: auth,
          }),
        ).workspace,
        bin = R.check(
          await R.api(s0, "/api/collection-recycle-bin/" + a.account.id, {
            cookie: auth,
          }),
        );
      assert.equal(w.rows.length, 0);
      assert.equal(
        bin.entries.filter((x) => x.row?.modelKod === "CREATE-DELETE-SYNTHETIC")
          .length,
        1,
      );
      return { rowId: id, workspace: w, bin };
    });
    await scenario("extra-two-moderators-rule-CAS", async () => {
      const user = R.check(
        await R.api(s0, "/api/users", {
          method: "POST",
          cookie: mod,
          body: {
            username: "E2E second moderator",
            reason: "Isolated synthetic concurrent-rule acceptance",
            confirmCritical: true,
            title: "Synthetic moderator",
            password: R.password,
            systemRole: "moderator",
            expectedRevision: R.check(
              await R.api(s0, "/api/users/admin", { cookie: mod }),
            ).revision,
          },
        }),
        201,
      ).user;
      const ma = await B.open(
          browser,
          s0,
          { id: "moderator", index: -1 },
          m.owner,
        ),
        mb = await B.open(browser, s0, { id: user.id, index: -2 }, user.id);
      try {
        for (const sess of [ma, mb]) B.instrument(sess, log);
        const current = R.check(
          await R.api(s0, "/api/pricing-rules", { cookie: mod }),
        );
        const request = (sess, royalty) =>
          sess.context.request.put(s0.base + "/api/pricing-rules", {
            headers: { "If-Match": String(current.revision) },
            data: { rules: current.rules.map((r) => ({ ...r, royalty })) },
          });
        const replies = await Promise.all([request(ma, 21), request(mb, 22)]),
          statuses = replies.map((r) => r.status()).sort();
        assert.deepEqual(statuses, [200, 409]);
        return {
          transport:
            "two independent authenticated BrowserContext request clients; focused HTTP CAS, not UI clicks",
          revision: current.revision,
          replies: await Promise.all(
            replies.map(async (r) => ({
              status: r.status(),
              data: await r.json(),
            })),
          ),
        };
      } finally {
        await ma.context.close();
        await mb.context.close();
      }
    });
    await scenario("extra-moderator-before-during-before-commit", async () => {
      const cookie = await R.login(s1, m.accounts[0].id),
        evidence = [];
      async function update() {
        const current = R.check(
            await R.api(s0, "/api/pricing-rules", { cookie: mod }),
          ),
          rules = current.rules.map((r) => ({
            ...r,
            royalty: Number(r.royalty) + 1,
          }));
        return R.check(
          await R.api(s0, "/api/pricing-rules", {
            method: "PUT",
            cookie: mod,
            headers: { "If-Match": String(current.revision) },
            body: { rules },
          }),
        );
      }
      async function converge(value) {
        R.check(
          await R.api(s0, "/api/shared-hub/publish-master", {
            method: "POST",
            cookie: mod,
            body: {},
          }),
        );
        for (let round = 1; round <= 4; round++) {
          const producer = await R.api(s0, "/api/sync-settings/sync-now", {
              method: "POST",
              cookie: mod,
            }),
            consumer = await R.api(s1, "/api/sync-settings/sync-now", {
              method: "POST",
              cookie,
            });
          log({
            type: "explicit-manual-sync-round",
            round,
            producer,
            consumer,
          });
          try {
            await R.until(
              async () => {
                await c.page.evaluate(() => refreshPricingRulesFromServer());
                return c.page.evaluate(
                  (value) =>
                    state.overrides.pricingRules.some(
                      (r) => Number(r.royalty) === value,
                    ),
                  value,
                );
              },
              { ms: 2500, label: "native rule content convergence" },
            );
            return;
          } catch (e) {
            log({
              type: "rule-not-yet-converged",
              round,
              value,
              actual: await c.page.evaluate(() => state.overrides.pricingRules),
            });
          }
        }
        throw Error(
          "Rule content did not converge in four bounded, explicitly logged manual SYNC rounds",
        );
      }
      await reset(c);
      let before = await B.calculate(c, 1),
        changed = await update();
      await converge(changed.rules[0].royalty);
      let after = await B.calculate(c, 1);
      assert.equal(after.lineage.rule.royalty, changed.rules[0].royalty);
      evidence.push({
        stage: "before-calculation",
        before: before.lineage,
        changed,
        after: after.lineage,
      });
      const entered = deferred(),
        release = deferred();
      await B.onceRoute(
        c.page,
        "**/api/collection-workspaces/*",
        async (route) => {
          if (route.request().method() !== "PATCH") return route.continue();
          const response = await route.fetch();
          entered.resolve({
            status: response.status(),
            data: await response.json(),
          });
          await release.promise;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      const saving = B.edit(c, 1, "RULE-CHANGE-BEFORE-ACK"),
        accepted = await R.deadline(entered.promise, "request barrier");
      changed = await update();
      release.resolve();
      const receipt = await saving;
      await converge(changed.rules[0].royalty);
      after = await B.calculate(c, 1);
      assert.equal(after.lineage.rule.royalty, changed.rules[0].royalty);
      evidence.push({
        stage: "durable-acceptance-before-client-result",
        accepted,
        changed,
        receipt,
        after: after.lineage,
      });
      const held = R.path.join(root, "commit-lease-held"),
        file = R.path.join(
          s1.root,
          "server/collection-workspaces/" + m.owner + ".json",
        ),
        code =
          "const fs=require('fs');require('./server/lib/shared-file-transaction').withFileLeaseAsync(process.argv[1],async()=>{fs.writeFileSync(process.argv[2],'held');await new Promise(r=>process.on('message',r));}).then(()=>process.exit());",
        locker = require("node:child_process").spawn(
          process.execPath,
          ["-e", code, file, held],
          {
            cwd: R.app,
            env: s1.env,
            stdio: ["ignore", "ignore", "inherit", "ipc"],
          },
        );
      try {
        await R.until(() => R.fs.existsSync(held));
        let complete = false;
        const pending = B.edit(c, 1, "RULE-CHANGE-BEFORE-COMMIT").finally(
          () => (complete = true),
        );
        await R.delay(700);
        assert.equal(complete, false);
        changed = await update();
        locker.send("release");
        const receipt = await pending;
        await converge(changed.rules[0].royalty);
        after = await B.calculate(c, 1);
        assert.equal(after.lineage.rule.royalty, changed.rules[0].royalty);
        evidence.push({
          stage: "backend-waiting-before-durable-commit",
          changed,
          receipt,
          after: after.lineage,
        });
      } finally {
        locker.kill();
      }
      return {
        evidence,
        limit:
          "Collection saves input data; calculated results are live projections. No undocumented global snapshot contract is asserted.",
      };
    });
    await scenario("extra-late-read-after-durable-save", async () => {
      await reset(c);
      const entered = deferred(),
        release = deferred();
      await B.onceRoute(
        c.page,
        "**/api/collection-workspaces/*",
        async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          const response = await route.fetch();
          entered.resolve();
          await release.promise;
          await route.fulfill({ response });
        },
        { method: "GET" },
      );
      const pending = c.page.evaluate(
        (owner) => kolHandleRemoteChange(owner, { mode: "reload" }),
        m.owner,
      );
      await R.deadline(entered.promise, "request barrier");
      const saved = await B.edit(c, 1, "LATE-READ-MUST-NOT-REVERT");
      assert.equal(saved.dirty, false);
      const fresh = R.check(
          await R.api(s0, "/api/collection-workspaces/" + m.owner, {
            cookie: mod,
          }),
        ).workspace,
        peer = fresh.rows.find((r) => r.id === 2);
      R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          method: "PATCH",
          cookie: mod,
          body: { upserts: [{ ...peer, modelKod: "PEER-WHILE-READ-PENDING" }] },
        }),
      );
      release.resolve();
      await pending;
      await c.page.locator("#kolSearch").focus();
      await R.until(
        async () => {
          const r = (await B.snapshot(c, 2)).row;
          return r?.modelKod === "PEER-WHILE-READ-PENDING";
        },
        { ms: 30000, label: "fresh read after guarded response discarded" },
      );
      const actual = await B.snapshot(c, 1);
      assert.equal(actual.row.modelKod, "LATE-READ-MUST-NOT-REVERT");
      assert.ok(actual.revision >= saved.revision);
      await c.page.screenshot({
        path: R.path.join(root, "late-read-preserved.png"),
      });
      return { saved, actual };
    });

    await scenario("extra-revocation-visible", async () => {
      await reset(a);
      const gate = await barrier(a),
        pending = B.edit(a, 1, "REVOKED-UI-DRAFT");
      await gate.entered;
      const revoke = R.check(
        await R.api(s0, "/api/collection-permissions/" + a.account.id, {
          method: "DELETE",
          cookie: mod,
          body: { ownerId: m.owner },
        }),
      );
      gate.release();
      const ui = await pending;
      assert.equal(ui.dirty, true);
      const persisted = R.check(
        await R.api(s0, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      assert.notEqual(
        persisted.rows.find((r) => r.id === 1).modelKod,
        "REVOKED-UI-DRAFT",
      );
      await a.page.screenshot({
        path: R.path.join(root, "permission-revoked.png"),
      });
      return { revoke, ui };
    });
    await scenario("extra-request-body-interrupted", async () => {
      await reset(c);
      const cookie = await R.login(s1, m.accounts[0].id),
        before = R.check(
          await R.api(s1, "/api/collection-workspaces/" + m.owner, { cookie }),
        ).workspace;
      await B.onceRoute(
        c.page,
        "**/api/collection-workspaces/*",
        async (route) => {
          const request = route.request(),
            body = request.postDataBuffer(),
            headers = await request.allHeaders();
          delete headers["content-length"];
          const cut = Math.max(1, Math.floor(body.length / 2));
          await new Promise((resolve) => {
            const req = require("node:http").request(
              request.url(),
              {
                method: request.method(),
                headers: { ...headers, "content-length": String(body.length) },
              },
              (res) => {
                res.resume();
                resolve();
              },
            );
            req.on("error", resolve);
            req.flushHeaders();
            req.write(body.subarray(0, cut));
            setTimeout(() => {
              log({
                type: "real-request-body-cut",
                sentBodyBytes: cut,
                totalBodyBytes: body.length,
                wireBytes: req.socket?.bytesWritten,
              });
              req.destroy();
            }, 30);
          });
          await route.abort("connectionreset");
        },
      );
      const ui = await B.edit(c, 1, "PARTIAL-BODY-NOT-ACCEPTED");
      assert.equal(ui.dirty, true);
      const after = R.check(
        await R.api(s1, "/api/collection-workspaces/" + m.owner, { cookie }),
      ).workspace;
      assert.equal(
        after.rows.find((r) => r.id === 1).modelKod,
        before.rows.find((r) => r.id === 1).modelKod,
      );
      const retry = await c.page.evaluate(async () => {
        const r = await kolSaveWorkspaceNow();
        return { ok: r.ok, pending: r.pending };
      });
      await B.settle(c);
      assert.equal(retry.ok, true);
      return { ui, retry };
    });
    await scenario("extra-manual-fx-price-preservation", async () => {
      await reset(c);
      await c.page.locator('[data-kol-drawer-open="1"]').first().click();
      await c.page.locator('[data-cpd-field="trFx"]').fill("25");
      await c.page.locator('[data-cpd-field="trFx"]').press("Tab");
      await B.settle(c);
      await c.page.locator("[data-cpd-manual]").click();
      await c.page.locator("#_kolManualMfr").fill("Demo Supplier");
      await c.page.locator("#_kolManualPriceInput").fill("6.25");
      await c.page.locator("#_kolManualConfirm").check();
      await c.page.locator("#_kolManualSave").click();
      await c.page.locator("#_kolManualPrice").waitFor({ state: "detached" });
      await c.page.evaluate(() => BLCollectionPriceDrawer.close());
      await B.settle(c);
      const before = await B.calculate(c, 1),
        fx = R.check(await R.api(s0, "/api/fx", { cookie: mod }));
      R.check(
        await R.api(s0, "/api/fx", {
          method: "PUT",
          cookie: mod,
          headers: { "If-Match": String(fx._revision) },
          body: { ...fx, months: { "2026-10": { TRY: 60 } } },
        }),
      );
      R.check(
        await R.api(s0, "/api/shared-hub/publish-master", {
          method: "POST",
          cookie: mod,
          body: {},
        }),
      );
      const cookie = await R.login(s1, m.accounts[0].id);
      R.check(
        await R.api(s1, "/api/sync-settings/sync-now", {
          method: "POST",
          cookie,
        }),
      );
      await R.until(
        async () => {
          await c.page.evaluate(() => BLFX.load(true));
          return c.page.evaluate(
            () => BLFX.store.months?.["2026-10"]?.TRY === 60,
          );
        },
        { ms: 15000, label: "automatic FX source arrived" },
      );
      const after = await B.calculate(c, 1);
      assert.equal(after.lineage.fx.manual, true);
      assert.equal(after.lineage.fx.rate, 25);
      assert.equal(after.lineage.values.suppFob, 6.25);
      return { before: before.lineage, after: after.lineage };
    });
    await a.context.tracing.stop({
      path: R.path.join(root, "controlled-trace.zip"),
    });
    R.fs.writeFileSync(
      R.path.join(root, "results.json"),
      JSON.stringify(
        { source: m.source, users: 3, backends: 2, results },
        null,
        2,
      ),
    );
    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
  } finally {
    await browser?.close();
    if (rt) for (const s of rt.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
