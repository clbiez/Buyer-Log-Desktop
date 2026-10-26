"use strict";
// Manual bounded acceptance driver. Never included in npm test; no automatic retries.
const R = require("./runtime.cjs"),
  B = require("./browser.cjs"),
  { sample } = require("./resources.cjs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const args = Object.fromEntries(
    process.argv.slice(2).map((v) => v.replace(/^--/, "").split("=")),
  ),
  users = Number(args.users || 3),
  seconds = Number(args.seconds || 30),
  backends = Number(args.backends || 3),
  seed = Number(args.seed || 20261025),
  root = R.path.resolve(
    args.root ||
      R.path.join("/workspace/scratch", "buyerlog-sync-" + Date.now()),
  );
const { seededRandom } = require("../../tests/helpers/sync-sim");
const random = seededRandom(seed),
  ledger = [],
  operations = [],
  sessions = [],
  pendingConvergence = [],
  observations = [],
  failures = [];
let capacityLimit = null,
  raceExpected = null,
  traceStopped = false;
let runtime,
  browser,
  monitor,
  observeTimer,
  minuteTimer,
  measurementAt = null,
  endAt = Infinity,
  stopping = false,
  serial = 0,
  phase = "setup",
  loopPromises = [],
  modCookie,
  moderator;
R.fs.mkdirSync(root, { recursive: true });
function write(x) {
  const record = { at: Date.now(), phase, ...x };
  R.fs.appendFileSync(
    R.path.join(root, "operations.jsonl"),
    JSON.stringify(record) + "\n",
  );
  ledger.push(record);
}
function pct(values, q) {
  if (!values.length) return null;
  const a = values.toSorted((a, b) => a - b);
  return a[Math.max(0, Math.ceil(q * a.length) - 1)];
}
function canonicalWorkspace(w) {
  const sort = (value) =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .filter((k) => !["_rev", "_sharedCollectionImageUrl"].includes(k))
              .sort()
              .map((k) => [k, sort(value[k])]),
          )
        : value;
  return JSON.stringify(
    sort({
      ownerId: w.ownerId,
      rows: w.rows,
      manufacturers: w.manufacturers || [],
      customColumns: w.customColumns || [],
      statusCatalog: w.statusCatalog || [],
      nextId: w.nextId,
    }),
  );
}
async function observe() {
  for (const s of sessions) {
    try {
      const state = await s.page.evaluate(() => ({
        owner: kolWorkspaceOwnerId,
        values: Array.from(
          document.querySelectorAll('#kolTable .editCell[data-k="modelKod"]'),
        ).map((e) => [String(e.dataset.id), e.value]),
        dirty: kolHasDirtyWorkspace(),
      }));
      if (state.owner !== runtime.manifest.owner) continue;
      const map = new Map(state.values);
      for (const p of pendingConvergence) {
        if (
          p.seen ||
          p.source === s.account.index ||
          p.backend === s.server.port
        )
          continue;
        if (map.get(String(p.rowId)) === p.value) {
          p.seen = true;
          const x = {
            type: "peer-visible",
            operationId: p.id,
            observer: s.account.id,
            observerBackend: s.server.port,
            elapsedMs: Date.now() - p.sentAt,
          };
          observations.push(x);
          write(x);
        }
      }
    } catch {}
  }
}
async function captureUiDiagnostic(s,op,stage){
  try{
    const state=await R.deadline(s.page.evaluate(()=>({url:location.href,owner:typeof kolWorkspaceOwnerId==='undefined'?null:kolWorkspaceOwnerId,active:document.activeElement?.outerHTML.slice(0,250),search:document.getElementById('kolSearch')?.value,rows:typeof kolRows==='undefined'?null:kolRows.map(r=>({id:r.id,model:r.modelKod})),editors:[...document.querySelectorAll('#kolTable .editCell[data-k="modelKod"]')].map(e=>({id:e.dataset.id,value:e.value})),dirty:typeof kolHasDirtyWorkspace==='function'?kolHasDirtyWorkspace():null,renderPending:typeof kolRemoteRenderPendingOwner==='undefined'?null:kolRemoteRenderPendingOwner,saving:typeof kolWorkspaceSaving==='undefined'?null:kolWorkspaceSaving,pending:typeof kolWorkspacePending==='undefined'?null:kolWorkspacePending,saveTimer:typeof kolWorkspaceSaveTimer==='undefined'?null:Boolean(kolWorkspaceSaveTimer),hasSavePromise:typeof kolWorkspaceSavePromise==='undefined'?null:Boolean(kolWorkspaceSavePromise),deferredPatches:typeof kolDeferredPatches==='undefined'?null:kolDeferredPatches.length})),"UI diagnostic",1500);
    write({type:"ui-diagnostic",operationId:op.id,user:s.account.id,stage,state});
  }catch(error){write({type:"ui-diagnostic-unavailable",operationId:op.id,user:s.account.id,stage,error:error.message});}
}
async function stopCpuDiagnostic(s,label){
  if(!s.cpuDiagnostic&&!s.debugDiagnostic)return;
  const hadProfile=Boolean(s.cpuDiagnostic),cpu=s.cpuDiagnostic||s.debugDiagnostic;s.cpuDiagnostic=null;s.debugDiagnostic=null;
  if(/failure/.test(label)||Boolean(s.failed)){
    // Forensics only AFTER a recorded failure. Pause the unresponsive renderer
    // to retain its real stack/profile; never resume this run as a success.
    try{const paused=new Promise(resolve=>cpu.once('Debugger.paused',resolve));await R.deadline(cpu.send('Debugger.pause'),'forensic pause command',2000);const detail=await R.deadline(paused,'forensic paused stack',2000);const sources=new Map();for(const frame of detail.callFrames.slice(0,6)){try{const id=frame.location.scriptId;if(!sources.has(id))sources.set(id,(await R.deadline(cpu.send('Debugger.getScriptSource',{scriptId:id}),'forensic source',2000)).scriptSource.split(String.fromCharCode(10)));frame.sourceAtPause=sources.get(id).slice(Math.max(0,frame.location.lineNumber-3),frame.location.lineNumber+4)}catch{}}R.fs.writeFileSync(R.path.join(root,label+'-stack.json'),JSON.stringify(detail,null,2));try{const shot=await R.deadline(cpu.send('Page.captureScreenshot',{format:'png'}),'paused screenshot',3000);R.fs.writeFileSync(R.path.join(root,label+'-paused.png'),Buffer.from(shot.data,'base64'));}catch{}write({type:'forensic-renderer-paused',user:s.account.id,afterFailure:true});}catch(error){write({type:'forensic-pause-unavailable',error:error.message});}
  }
  if(!hadProfile)return;
  try{const {profile}=await R.deadline(cpu.send('Profiler.stop'),"CPU diagnostic stop",5000);R.fs.writeFileSync(R.path.join(root,label+'.cpuprofile'),JSON.stringify(profile));}catch(error){write({type:"cpu-diagnostic-unavailable",user:s.account.id,error:error.message});}
}
async function action(s, kind, fn, expected = {}) {
  const op = {
    id: `op-${seed}-${++serial}`,
    user: s.account.id,
    userIndex: s.account.index,
    backend: s.server.port,
    kind,
    ...expected,
    sentAt: Date.now(),
    phase,
  };
  s.currentOp = op;
  operations.push(op);
  write({ type: "intent", ...op });
  try {
    if(args.diagnostics)await captureUiDiagnostic(s,op,'before');
    const result = await R.deadline(fn(op),kind+" whole UI action",60000);
    op.elapsedMs = Date.now() - op.sentAt;
    op.result = result;
    op.finishedAt = Date.now();
    op.outcome = result?.dirty ? "acceptance-uncertain" : "completed";
    write({ type: "ui-result", ...op });
    if (result?.dirty && !s.plannedFault) {
      if (result.feedback?.status === "conflict") {
        op.outcome = "explicit-conflict";
        write({
          type: "simulated-user-resolution",
          operationId: op.id,
          choice: "adopt server; do not retry rejected intent",
          draft: result.pending,
        });
        await B.recoverAccepted(s,write);
      } else
        throw Error("UI remains dirty: " + JSON.stringify(result.feedback));
    }
    s.operations.push(op);
    return op;
  } catch (e) {
    op.elapsedMs = Date.now() - op.sentAt;
    op.error = e.message;
    op.outcome = "driver-or-product-failure";
    write({ type: "operation-error", ...op });
    failures.push({ operationId: op.id, user: s.account.id, error: e.message });
    if(args.diagnostics){await captureUiDiagnostic(s,op,'failure');await stopCpuDiagnostic(s,op.id+'-failure');}
    await s.page
      .screenshot({ path: R.path.join(root, op.id + "-failed.png") })
      .catch(() => {});
    throw e;
  } finally {
    s.currentOp = null;
  }
}
function verifyCalculation(calc) {
  const l = calc.lineage,
    k = calc.landed,
    rule = calc.pricingRules.find((r) => String(r.id) === String(l.rule?.id));
  const checks = [];
  checks.push({
    name: "pricing-source-revision",
    expected: calc.pricingRevision,
    actual: l.revisions.pricingRules,
    ok: calc.pricingRevision === l.revisions.pricingRules,
  });
  checks.push({
    name: "fx-source-revision",
    expected: calc.fx?._revision,
    actual: l.fx.revision,
    ok: calc.fx?._revision === l.fx.revision,
  });
  if (!l.fx.manual) {
    const months = Object.keys(calc.fx?.months || {}).sort(),
      requested = l.fx.requestedMonth,
      applied = months.includes(requested)
        ? requested
        : months.filter((m) => m < requested).at(-1) || months[0],
      rate = calc.fx?.months?.[applied]?.TRY;
    checks.push({
      name: "fx-month-and-rate",
      expected: { month: applied, rate },
      actual: { month: l.fx.resolvedMonth, rate: l.fx.rate },
      ok: applied === l.fx.resolvedMonth && Number(rate) === Number(l.fx.rate),
    });
  }
  if (rule && l.values.suppFob != null) {
    const ydRate = Number(rule.royalty) + Number(rule.ydCommission || 0),
      trRate = Number(rule.royalty) + Number(rule.trCommission || 0),
      h = Number(rule.hologramCost || 0);
    const yd = (l.values.suppFob / (1 - ydRate / 100) + h) * k.ydMult;
    checks.push({
      name: "overseas-landed",
      expected: yd,
      actual: l.values.overseasLanded,
      ok: Math.abs(yd - l.values.overseasLanded) < 1e-9,
    });
    const tr =
      (Math.round((k.trPrice / l.fx.rate / (1 - trRate / 100) + h) * 100) /
        100) *
      k.trMult;
    checks.push({
      name: "tr-landed",
      expected: tr,
      actual: l.values.trLanded,
      ok: Math.abs(tr - l.values.trLanded) < 1e-9,
    });
  }
  return checks;
}
async function daily(s) {
  const random = seededRandom(seed ^ (s.account.index + 1));
  let turn = 0;
  while (!stopping && Date.now() < endAt) {
    if (s.paused) {
      await R.delay(100);
      continue;
    }
    try {
      const rowId = s.account.index + 1;
      s.plannedFault = false;
      const planned = s.nextFault;
      s.nextFault = null;
      if (planned === "response-loss") {
        s.plannedFault = true;
        await B.onceRoute(
          s.page,
          "**/api/collection-workspaces/*",
          async (route) => {
            if (route.request().method() !== "PATCH") return route.continue();
            const response = await route.fetch();
            const accepted = await response.json();
            assert.ok(route.request().__requestId,"suppressed native ACK must retain its actual request ID");
            write({
              type: "upstream-acceptance",
              operationId: route.request().__operationId,
              requestId: route.request().__requestId,
              sessionId: s.id,
              user: s.account.id,
              status: response.status(),
              data: accepted,
              delivery: "suppressed",
            });
            await route.abort("connectionreset");
          },
          { times: 1 },
        );
      }
      if (planned === "offline") {
        s.plannedFault = true;
        await s.context.setOffline(true);
        write({ type: "fault-offline", user: s.account.id });
      }
      const op = await action(
        s,
        "edit",
        async (op) => B.edit(s, rowId, op.id),
        { rowId, field: "modelKod" },
      );
      pendingConvergence.push({
        id: op.id,
        source: s.account.index,
        backend: s.server.port,
        rowId,
        value: op.id,
        sentAt: op.sentAt,
      });
      if (s.plannedFault) {
        if (planned === "offline") await s.context.setOffline(false);
        write({ type: "fault-reconnected", user: s.account.id });
        const durable = R.check(
          await R.api(
            s.server,
            "/api/collection-workspaces/" + runtime.manifest.owner,
            { cookie: s.cookie },
          ),
        );
        write({
          type: "ambiguous-investigation",
          operationId: op.id,
          workspace: durable.workspace,
        });
        const retry = await s.page.evaluate(async () => {
          const r = await kolSaveWorkspaceNow();
          return { ok: r.ok, pending: r.pending, revision: r.revision };
        });
        write({ type: "application-retry", operationId: op.id, result: retry });
        await B.settle(s);
        s.plannedFault = false;
      }
      if (turn % 3 === 0) {
        await action(
          s,
          "calculate",
          async () => {
            const calc = await B.calculate(s, rowId),
              checks = verifyCalculation(calc);
            write({
              type: "calculation-evidence",
              user: s.account.id,
              rowId,
              ...calc,
              independentChecks: checks,
            });
            assert.ok(checks.length > 0, "matching native rule required");
            assert.ok(
              checks.every((x) => x.ok),
              "independent arithmetic mismatch",
            );
            return { elapsedMs: calc.elapsedMs, checks };
          },
          { rowId },
        );
      }
      if (turn % 4 === 1) {
        await action(s, "list-filter", async () => {
          await s.page.locator("#kolSearch").fill("SYN");
          await s.page.locator("#kolSearch").fill("");
          return {
            visible: await s.page.locator("#kolTable tbody tr").count(),
          };
        });
      }
      if (
        measurementAt &&
        !s.didMeasuredCRUD &&
        Date.now() > measurementAt + 30000 &&
        s.account.index > 0
      ) {
        s.didMeasuredCRUD = true;
        await action(s, "create-delete", async (op) => {
          await s.page.evaluate(
            async (owner) => kolLoadWorkspace(owner),
            s.account.id,
          );
          await s.page.locator("#kolAddRowBtn").click();
          const id = await s.page.evaluate(() => kolRows[0].id);
          await B.edit(s, id, op.id);
          await s.page
            .locator('#kolTable .rowChk[data-id="' + id + '"]')
            .check();
          await s.page.locator("#kolDelRowBtn").click();
          await s.page
            .locator("#_kolSelectedActionConfirm [data-confirm]")
            .click();
          await s.page.waitForFunction(
            (id) => !kolRows.some((r) => r.id === id),
            id,
          );
          await B.settle(s);
          const own = R.check(
              await R.api(
                s.server,
                "/api/collection-workspaces/" + s.account.id,
                { cookie: s.cookie },
              ),
            ).workspace,
            bin = R.check(
              await R.api(
                s.server,
                "/api/collection-recycle-bin/" + s.account.id,
                { cookie: s.cookie },
              ),
            );
          assert.equal(own.rows.filter((r) => r.modelKod === op.id).length, 0);
          assert.equal(
            bin.entries.filter((e) => e.row?.modelKod === op.id).length,
            1,
          );
          await s.page.evaluate(
            async (owner) => kolLoadWorkspace(owner),
            s.owner,
          );
          return { createdAndDeletedId: id, archivedCopies: 1 };
        });
      }
      turn++;
      await R.delay(Number(args["think-min-ms"]??10000)+Math.floor(random()*Number(args["think-range-ms"]??10000)));
    } catch (e) {
      s.failed = e.message;
      write({ type: "session-stopped", user: s.account.id, error: e.message });
      break;
    }
  }
}
async function moderatorStep(turn) {
  const p = moderator.page;
  const family = turn % 3;
  if (family === 0) {
    await action(moderator, "moderator-royalty", async () => {
      await p.evaluate(async () => {
        await refreshPricingRulesFromServer();
        openSuppFobRulesModal();
      });
      await p.locator("#_rulesBody .editRule").first().click();
      await p.locator("#_ruleRoyalty").fill(String(21 + (turn % 5)));
      await p.locator("#_ruleAdd").click();
      const response = p.waitForResponse(
        (r) =>
          r.url().includes("/api/pricing-rules") &&
          r.request().method() === "PUT",
      );
      await p.locator("#_rulesSave").click();
      const reply = await response;
      const data = await reply.json();
      write({ type: "moderator-rule-response", status: reply.status(), data });
      if (reply.status() === 409) {
        const draft = await p.locator("#_rulesStatus").innerText();
        await p.evaluate(() =>
          document.getElementById("_suppFobRulesModal")?.remove(),
        );
        return { explicitlyRejected: true, status: 409, draft };
      }
      assert.equal(reply.status(), 200);
      await p
        .locator("#_rulesSave")
        .waitFor({ state: "detached", timeout: 30000 });
      return { saved: true, revision: data.revision };
    });
  } else if (family === 1) {
    await action(moderator, "moderator-transit", async () => {
      await p.evaluate(() => openTransitRulesModal());
      if (await p.locator("#_transitBody .editTransit").count())
        await p.locator("#_transitBody .editTransit").first().click();
      await p.locator("#_transitDays").fill(String(30 + turn));
      await p.locator("#_transitAdd").click();
      await p.locator("#_transitSave").click();
      await p.locator("#_transitSave").waitFor({ state: "detached" });
      return { saved: true };
    });
  } else {
    await action(moderator, "moderator-fx", async () => {
      const XLSX = require("xlsx"),
        rate = 42 + turn,
        file = R.path.join(root, "fx-update-" + turn + ".xlsx"),
        workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["Synthetic FX forecast"],
          [null, null, "2026-10"],
          [null, "TRY", rate],
          [null, "EUR", 0.9],
          [null, "GBP", 0.8],
        ]),
        "Demo",
      );
      XLSX.writeFile(workbook, file);
      await p.evaluate(async () => {
        switchTab("source");
        await BLPerf.ensureFeature("fx");
      });
      await p.locator("#sourceFxFile").setInputFiles(file);
      await p.waitForFunction(
        (rate) => BLFX.store?.months?.["2026-10"]?.TRY === rate,
        rate,
      );
      const saved = R.check(
        await R.api(moderator.server, "/api/fx", { cookie: modCookie }),
      );
      assert.equal(saved.months["2026-10"].TRY, rate);
      write({
        type: "moderator-fx-ui-import",
        revision: saved._revision,
        months: saved.months,
        sourceFingerprint: saved.sourceFingerprint,
      });
      await p.evaluate(() => switchTab("koleksiyon"));
      return { saved: true, revision: saved._revision };
    });
  }
  for (const s of runtime.servers) {
    const index = runtime.servers.indexOf(s),
      c = await R.login(
        s,
        index === 0 ? "moderator" : runtime.manifest.accounts[index].id,
      );
    const result = await R.api(s, "/api/sync-settings/sync-now", {
      method: "POST",
      cookie: c,
    });
    write({
      type: "sync-round",
      backend: s.port,
      status: result.status,
      data: result.data,
    });
  }
}
async function controlledRace() {
  if (sessions.length < 2) return;
  const a = sessions[0],
    b = sessions[1],
    owner = runtime.manifest.owner,
    rowId = 1,
    valueA = "controlled-" + seed + "-A",
    valueB = "controlled-" + seed + "-B";
  a.paused = b.paused = true;
  try {
    await R.until(() => !a.currentOp && !b.currentOp, {
      ms: 45000,
      label: "race participants finish current UI action",
    });
    for (const s of [a, b])
      await s.page.evaluate(async (owner) => {
        await kolLoadWorkspace(owner);
      }, owner);
    const deferred = () => {
      let resolve;
      return {
        promise: new Promise((r) => (resolve = r)),
        resolve: (v) => resolve(v),
      };
    };
    const ga = { entered: deferred(), release: deferred() },
      gb = { entered: deferred(), release: deferred() };
    for (const [session, gate] of [
      [a, ga],
      [b, gb],
    ])
      await B.onceRoute(
        session.page,
        "**/api/collection-workspaces/*",
        async (route) => {
          gate.entered.resolve(route.request().postDataJSON());
          await gate.release.promise;
          await route.continue();
        },
      );
    const pa = action(
        a,
        "controlled-conflict",
        () => B.edit(a, rowId, valueA, "specialCode"),
        { rowId, field: "specialCode", expectedValue: valueA },
      ),
      pb = action(
        b,
        "controlled-conflict",
        () => B.edit(b, rowId, valueB, "specialCode"),
        { rowId, field: "specialCode", expectedValue: valueB },
      );
    await R.deadline(
      Promise.all([ga.entered.promise, gb.entered.promise]),
      "controlled conflict request barrier",
    );
    ga.release.resolve();
    const first = await pa;
    gb.release.resolve();
    const second = await pb;
    const responses = b.responses.filter((r) => r.operationId === second.id);
    assert.ok(
      second.result.dirty ||
        responses.some(
          (r) =>
            r.data.conflicts?.length ||
            r.data.replication?.mergeConflicts ||
            r.data.replication?.conflicts ||
            r.data.replication?.state === "conflict",
        ),
      "second conflicting value must be explicitly rejected or retained in Sync Conflicts",
    );
    const durable = R.check(
      await R.api(a.server, "/api/collection-workspaces/" + owner, {
        cookie: a.cookie,
      }),
    ).workspace;
    assert.equal(
      durable.rows.find((r) => String(r.id) === String(rowId)).specialCode,
      valueA,
    );
    raceExpected = { rowId, field: "specialCode", value: valueA };
    write({
      type: "controlled-conflict-complete",
      first,
      second,
      responses,
      durableWinner: valueA,
    });
    for (const s of [a, b]) {
      await B.recoverAccepted(s,write);
    }
  } finally {
    a.paused = b.paused = false;
  }
}
const originBeforeFinalImports=new Map();
function captureBeforeFinalImports(){
  if(originBeforeFinalImports.size)return;
  for(const server of runtime.servers){
    const index=server.port-runtime.manifest.port,file=R.path.join(server.root,'server/collection-workspaces/'+runtime.manifest.owner+'.json');
    const workspace=R.fs.existsSync(file)?JSON.parse(R.fs.readFileSync(file,'utf8')):{missingBeforeFinalImport:true};
    originBeforeFinalImports.set(server.port,workspace);
    R.fs.writeFileSync(R.path.join(root,'pre-quiescence-device-'+index+'.json'),JSON.stringify(workspace,null,2));
  }
  write({type:'pre-quiescence-durable-capture',backends:originBeforeFinalImports.size,detail:'Before final UI recovery or GET imports can repair a local replica'});
}
async function reconcile() {
  phase = "reconciliation";
  captureBeforeFinalImports();
  await observe();
  const m = runtime.manifest,
    states = [];
  for (const s of runtime.servers) {
    const index = runtime.servers.indexOf(s),
      c = await R.login(s, index === 0 ? "moderator" : m.accounts[index].id);
    R.check(
      await R.api(s, "/api/collection-workspaces/" + m.owner, { cookie: c }),
    );
    const file = R.path.join(
        s.root,
        "server/collection-workspaces/" + m.owner + ".json",
      ),
      workspace = JSON.parse(R.fs.readFileSync(file, "utf8"));
    R.fs.writeFileSync(
      R.path.join(root, "durable-device-" + (s.port - m.port) + ".json"),
      JSON.stringify(workspace, null, 2),
    );
    states.push({
      backend: s.port,
      workspace,
      hash: crypto
        .createHash("sha256")
        .update(JSON.stringify(workspace.rows))
        .digest("hex"),
    });
  }
  const expected = new Map();
  const submittedByRequest=new Map(ledger.filter(x=>x.type==="submitted").map(x=>[x.requestId,x]));
  for (const x of ledger.filter(
    (x) =>
      ["server-response", "upstream-acceptance"].includes(x.type) &&
      x.status === 200 &&
      x.operationId,
  )) {
    const intent = operations.find((o) => o.id === x.operationId);
    if (!intent || intent.kind !== "edit") continue;
    const applied = x.data.applied || [];
    const request=submittedByRequest.get(x.requestId);
    const sent=request?.body?.upserts?.find(row=>String(row.id)===String(intent.rowId));
    // An automatic pricing write can run during an edit intent. It is not proof
    // that the intent's new model value was submitted or accepted.
    if (request?.url==="/api/collection-workspaces/"+m.owner && sent?.[intent.field]===intent.id && applied.some((a) => String(a.id) === String(intent.rowId)))
      expected.set(String(intent.rowId), {
        value: intent.id,
        operationId: intent.id,
        backend:request.backend,
        requestId:x.requestId,
        at: x.at,
      });
  }
  const mismatches = [];
  for(const [id,expect] of expected){
    const actual=originBeforeFinalImports.get(expect.backend)?.rows?.find(row=>String(row.id)===id)?.modelKod;
    if(actual!==expect.value)mismatches.push({kind:'origin-before-final-import',backend:expect.backend,rowId:id,expected:expect.value,actual});
  }
  for (const state of states) {
    const ids = new Set();
    for (const row of state.workspace.rows) {
      const i = Number(row.id) - 1;
      if (ids.has(String(row.id)))
        mismatches.push({ backend: state.backend, duplicateRowId: row.id });
      ids.add(String(row.id));
      for (const [field, value] of Object.entries({
        plmId: "SYN-" + i,
        season: "W26",
        country: "China",
        lisans: "E2E LICENSE",
        licensor: "E2E LICENSOR",
        qty: 100,
        trPrice: "400",
        trFx: "",
        exFactory: "2026-10-25",
        confirmedManufacturer: "Demo Supplier",
      })) {
        if (String(row[field] ?? "") !== String(value))
          mismatches.push({
            backend: state.backend,
            rowId: row.id,
            field,
            expected: value,
            actual: row[field],
          });
      }
      if (String(row.pricing?.["Demo Supplier"]) !== "4")
        mismatches.push({
          backend: state.backend,
          rowId: row.id,
          field: "pricing",
          actual: row.pricing,
        });
    }
    if (ids.size !== m.users)
      mismatches.push({
        backend: state.backend,
        expectedRows: m.users,
        actualRows: ids.size,
      });
    if (state.workspace.ownerId !== m.owner)
      mismatches.push({
        backend: state.backend,
        wrongOwner: state.workspace.ownerId,
      });
  }
  for (const s of states)
    for (const [id, expect] of expected) {
      const row = s.workspace.rows.find((r) => String(r.id) === id);
      if (row?.modelKod !== expect.value)
        mismatches.push({
          backend: s.backend,
          rowId: id,
          expected: expect.value,
          actual: row?.modelKod,
        });
    }
  if (raceExpected)
    for (const state of states) {
      const row = state.workspace.rows.find(
        (r) => String(r.id) === String(raceExpected.rowId),
      );
      if (row?.[raceExpected.field] !== raceExpected.value)
        mismatches.push({
          backend: state.backend,
          controlledField: raceExpected,
          actual: row?.[raceExpected.field],
        });
    }
  const referenceContent = canonicalWorkspace(states[0].workspace);
  for (const state of states)
    if (canonicalWorkspace(state.workspace) !== referenceContent)
      mismatches.push({
        backend: state.backend,
        kind: "full-replica-content",
        detail:
          "Field/relationship/order/metadata differs from device zero; raw snapshots retained",
      });
  const clientMismatches = [];
  for (const s of sessions) {
    try {
      await R.until(
        async () => {
          const snap = await s.page.evaluate(
            (race) => ({
              values: Array.from(
                document.querySelectorAll(
                  '#kolTable .editCell[data-k="modelKod"]',
                ),
              ).map((e) => [String(e.dataset.id), e.value]),
              controlled: race
                ? Array.from(
                    document.querySelectorAll("#kolTable .editCell[data-id]"),
                  ).find(
                    (e) =>
                      String(e.dataset.id) === String(race.rowId) &&
                      e.dataset.k === race.field,
                  )?.value
                : null,
            }),
            raceExpected,
          );
          const map = new Map(snap.values);
          return (
            [...expected].every(([id, x]) => map.get(id) === x.value) &&
            (!raceExpected || snap.controlled === raceExpected.value)
          );
        },
        { ms: 30000, label: "final UI convergence" },
      );
    } catch (e) {
      clientMismatches.push({
        user: s.account.id,
        error: e.message,
        snapshot: await s.page.evaluate(() => ({
          rows: kolRows.map((r) => ({
            id: r.id,
            modelKod: r.modelKod,
            _rev: r._rev,
          })),
          revision: kolWorkspaceRevision,
          dirty: kolHasDirtyWorkspace(),
          feedback: kolSaveFeedbackByOwner.get(kolWorkspaceOwnerId),
          deferred: kolDeferredPatches,
          pending: kolReadPendingWorkspace(kolWorkspaceOwnerId),
          renderedEditors: Array.from(
            document.querySelectorAll("#kolTable .editCell[data-id]"),
          ).map((e) => ({
            id: e.dataset.id,
            field: e.dataset.k,
            value: e.value,
          })),
        })),
      });
    }
  }
  if (!traceStopped && sessions[0]) {
    await sessions[0].context.tracing
      .stop({ path: R.path.join(root, "trace-capacity.zip") })
      .catch(() => {});
    traceStopped = true;
  }
  await browser?.close();
  browser = null;
  // All backends are stopped before the persisted files are read again, then cold-opened.
  for (const s of runtime.servers) await R.stopServer(s);
  const cold = [];
  for (let i = 0; i < runtime.servers.length; i++) {
    const s = await R.startServer(
      R.path.join(root, "device-" + i),
      m.port + i,
      m.hub,
    );
    runtime.servers[i] = s;
    const c = await R.login(s, i === 0 ? "moderator" : m.accounts[i].id),
      w = R.check(
        await R.api(s, "/api/collection-workspaces/" + m.owner, { cookie: c }),
      ).workspace;
    const before = states.find((x) => x.backend === s.port);
    const contentHash = crypto
      .createHash("sha256")
      .update(canonicalWorkspace(w))
      .digest("hex");
    if (
      before &&
      canonicalWorkspace(before.workspace) !== canonicalWorkspace(w)
    )
      mismatches.push({
        backend: s.port,
        cold: true,
        kind: "full-content-changed-on-cold-reopen",
      });
    R.fs.writeFileSync(
      R.path.join(root, `cold-device-${i}.json`),
      JSON.stringify(w, null, 2),
    );
    cold.push({
      backend: s.port,
      revision: w._revision,
      contentHash,
      rows: w.rows.map((r) => ({
        id: r.id,
        modelKod: r.modelKod,
        _rev: r._rev,
      })),
    });
    for (const [id, x] of expected) {
      if (w.rows.find((r) => String(r.id) === id)?.modelKod !== x.value)
        mismatches.push({
          backend: s.port,
          cold: true,
          rowId: id,
          expected: x.value,
        });
    }
  }
  const out = {
    expected: [...expected],
    mismatches,
    clientMismatches,
    states: states.map((x) => ({
      backend: x.backend,
      hash: x.hash,
      revision: x.workspace._revision,
      rows: x.workspace.rows.length,
    })),
    cold,
  };
  R.fs.writeFileSync(
    R.path.join(root, "reconciliation.json"),
    JSON.stringify(out, null, 2),
  );
  return out;
}
(async () => {
  try {
    runtime = await R.setup(root, { users, backends, port:Number(args.port||7320), startBackends: 1 });
    write({
      type: "manifest",
      ...runtime.manifest,
      seed,
      seconds,
      diagnostics: Boolean(args.diagnostics),
      traceMode: args["trace-mode"] || "events",
      cpuProfilerUserIndex: args.diagnostics ? 1 : null,
      environment: {
        node: process.version,
        platform: process.platform,
        cpuQuota: "2 CPU",
        memoryLimitBytes: 8589934592,
        realNetworkShare: false,
      },
    });
    browser = await B.launch();
    R.fs.writeFileSync(R.path.join(root,'browser-environment.json'),JSON.stringify(browser.__buyerLogToolchain,null,2));
    write({type:'browser-environment',...browser.__buyerLogToolchain});
    phase = "ramp";
    monitor = setInterval(() => {
      const data = sample(process.pid, runtime.servers);
      R.fs.appendFileSync(
        R.path.join(root, "resources.jsonl"),
        JSON.stringify(data) + "\n",
      );
      if (data.memoryCurrent > 7.5 * 1024 ** 3 && !stopping) {
        capacityLimit = {
          opened: sessions.length,
          memoryCurrent: data.memoryCurrent,
          at: Date.now(),
        };
        endAt = Math.min(endAt, Date.now());
        write({
          type: "environment-capacity-limit",
          opened: sessions.length,
          memoryCurrent: data.memoryCurrent,
        });
        stopping = true;
      }
    }, 5000);
    monitor.unref();
    for (const account of runtime.manifest.accounts) {
      if (sessions.some((s) => s.failed)) throw Error("Ramp session failed");
      if (stopping)
        throw Error("Measured environment memory capacity limit before 50");
      const index = account.index % backends;
      if (!runtime.servers[index]) {
        const added = await R.startServer(
          R.path.join(root, "device-" + index),
          runtime.manifest.port + index,
          runtime.manifest.hub,
        );
        runtime.servers[index] = added;
        const auth = await R.login(added, account.id);
        R.check(
          await R.api(added, "/api/sync-settings", {
            method: "PUT",
            cookie: auth,
            body: {
              sharedSyncRoot: runtime.manifest.hub,
              syncPeriodMinutes: "manual",
            },
          }),
        );
      }
      if (stopping)
        throw Error(
          "Measured environment memory capacity limit while starting independent backends",
        );
      const server = runtime.servers[index];
      const s = await B.open(browser, server, account, runtime.manifest.owner, {
        trace: account.index === 0 ? (args['trace-mode'] || 'events') : false,
      });
      s.cookie = await B.cookie(s);
      if(args.diagnostics){s.debugDiagnostic=await s.context.newCDPSession(s.page);await s.debugDiagnostic.send('Debugger.enable');if(account.index===1){s.cpuDiagnostic=s.debugDiagnostic;await s.cpuDiagnostic.send('Profiler.enable');await s.cpuDiagnostic.send('Profiler.setSamplingInterval',{interval:10000});await s.cpuDiagnostic.send('Profiler.start');}}
      sessions.push(s);
      B.instrument(s, write);
      loopPromises.push(daily(s));
      write({
        type: "ramp-session-active",
        count: sessions.length,
        user: account.id,
        backend: server.port,
      });
      console.log("RAMP", sessions.length + "/" + users);
    }
    moderator = await B.open(
      browser,
      runtime.servers[0],
      { id: "moderator", index: -1 },
      runtime.manifest.owner,
    );
    B.instrument(moderator, write);
    modCookie = await B.cookie(moderator);
    await R.until(
      () => {
        const failed=sessions.find(s=>s.failed);
        if(failed)throw Error("UI session failed during ramp: "+failed.account.id+": "+failed.failed);
        return sessions.every(s=>s.operations.some(o=>o.kind==="edit"));
      },
      { ms: 60000, label: "all users completed UI edit" },
    );
    for (const session of [...sessions, moderator])
      session.networkAtStart = { ...session.network };
    measurementAt = Date.now();
    endAt = measurementAt + seconds * 1000;
    phase = "measured";
    write({ type: "measurement-start", users, measurementAt, endAt });
    console.log(
      "MEASUREMENT START",
      new Date(measurementAt).toISOString(),
      seconds + "s",
    );
    let observing = false;
    observeTimer = setInterval(async () => {
      if (observing) return;
      observing = true;
      try {
        await observe();
      } finally {
        observing = false;
      }
    }, 2000);
    observeTimer.unref();
    minuteTimer = setInterval(() => {
      const minute = Math.floor((Date.now() - measurementAt) / 60000),
        windowEnd = Math.min(endAt, measurementAt + minute * 60000),
        windowStart = Math.max(measurementAt, windowEnd - 60000);
      const counts = sessions.map((s) => ({
        user: s.account.id,
        completedUiOperations: s.operations.filter(
          (o) => o.finishedAt >= windowStart && o.finishedAt <= windowEnd,
        ).length,
        failed: s.failed || null,
      }));
      if(minute>Math.floor(seconds/60))return;
      write({
        type: "minute-activity",
        minute,
        active: counts.filter((c) => c.completedUiOperations > 0).length,
        counts,
      });
      console.log(
        "MINUTE",
        minute,
        "ACTIVE",
        counts.filter((c) => c.completedUiOperations > 0).length,
        "OPS",
        counts.reduce((a, c) => a + c.completedUiOperations, 0),
      );
    }, 60000);
    minuteTimer.unref();
    let turn = 0;
    while (Date.now() < endAt && !stopping) {
      await moderatorStep(turn++);
      if (turn === Number(args["race-turn"] ?? 5)) await controlledRace();
      if (turn === 2)
        sessions[Math.min(1, users - 1)].nextFault = "response-loss";
      if (turn === 4) sessions[Math.min(2, users - 1)].nextFault = "offline";
      if (sessions.some((s) => s.failed))
        throw Error("Active session failed; preserve failed run");
      await R.delay(Math.min(Number(args["moderator-interval-ms"]??45000), Math.max(0, endAt - Date.now())));
    }
    stopping = true;
    await Promise.all(loopPromises);
    captureBeforeFinalImports();
    for (const session of sessions) {
      await session.page.locator("#kolTable").focus();
      await B.settle(session);
      for(let attempt=0;attempt<2;attempt++){
        const state=await B.recoverAccepted(session,write);
        if(!state.dirty)break;
      }
    }
    write({
      type: "quiescence",
      detail: "Users leave the edited row; deferred live patches may now apply",
    });
    clearInterval(observeTimer);
    clearInterval(minuteTimer);
    const actualDurationMs = Date.now() - measurementAt;
    write({ type: "measurement-end", actualDurationMs, users });
    if (sessions.length)
      await sessions[0].page.screenshot({
        path: R.path.join(root, "final-ui.png"),
      });
    await sessions[0]?.context.tracing.stop({
      path: R.path.join(root, "trace-user-0.zip"),
    });
    traceStopped = true;
    for(const s of sessions)await stopCpuDiagnostic(s,'user-'+s.account.index+'-completed');
    const reconciliation = await reconcile();
    const measured = operations.filter(
      (o) => o.sentAt >= measurementAt && o.sentAt < endAt,
    );
    const latencies = measured
        .filter((o) => o.kind === "edit" && !o.error)
        .map((o) => o.elapsedMs),
      calc = measured
        .filter((o) => o.kind === "calculate" && !o.error)
        .map((o) => o.elapsedMs);
    const measuredIds = new Set(measured.map((o) => o.id)),
      observed = observations.filter((x) => measuredIds.has(x.operationId)),
      activity = Array.from({length:Math.floor(seconds/60)},(_,index)=>{
        const minute=index+1,windowStart=measurementAt+index*60000,windowEnd=windowStart+60000;
        const counts=sessions.map(s=>({user:s.account.id,completedUiOperations:s.operations.filter(o=>o.finishedAt>=windowStart&&o.finishedAt<windowEnd).length,failed:s.failed||null}));
        return {type:'minute-activity',minute,windowStart,windowEnd,active:counts.filter(c=>c.completedUiOperations>0).length,counts};
      }),
      activityComplete =
        activity.length === Math.floor(seconds / 60) &&
        activity.every((x) => x.active === users);
    const result = {
      activityComplete,
      activitySource:"completed native UI operations reconciled in half-open per-minute windows; periodic timer telemetry retained separately",
      activity,
      status:
        capacityLimit ||
        !activityComplete ||
        failures.length ||
        reconciliation.mismatches.length ||
        reconciliation.clientMismatches.length
          ? "failed"
          : "passed",
      users,
      requestedSeconds: seconds,
      capacityLimit,
      httpNetwork: [...sessions, moderator].filter(Boolean).map((s) => ({
        user: s.account.id,
        backend: s.server.port,
        requestBytes:
          s.network.requestBytes - (s.networkAtStart?.requestBytes || 0),
        responseBytes:
          s.network.responseBytes - (s.networkAtStart?.responseBytes || 0),
        completedRequests:
          s.network.completedRequests -
          (s.networkAtStart?.completedRequests || 0),
      })),
      backendInstances: runtime.servers.length,
      independentDataRoots: runtime.servers.length,
      replicas: runtime.servers.length,
      realNetworkShare: false,
      seed,
      source: runtime.manifest.source,
      measurementAt,
      endAt,
      actualDurationMs,
      measurementDurationMs: endAt - measurementAt,
      drainDurationMs: Math.max(0, actualDurationMs - (endAt - measurementAt)),
      completedOperations: measured.filter((o) => !o.error).length,
      perUser: sessions.map((s) => ({
        user: s.account.id,
        operations: s.operations.filter(
          (o) => o.sentAt >= measurementAt && o.sentAt < endAt,
        ).length,
      })),
      saveLatencyMs: {
        p50: pct(latencies, 0.5),
        p95: pct(latencies, 0.95),
        p99: pct(latencies, 0.99),
      },
      calculationLatencyMs: {
        p50: pct(calc, 0.5),
        p95: pct(calc, 0.95),
        p99: pct(calc, 0.99),
      },
      visibilityMs: {
        samples: observed.length,
        p50: pct(
          observed.map((x) => x.elapsedMs),
          0.5,
        ),
        p95: pct(
          observed.map((x) => x.elapsedMs),
          0.95,
        ),
        p99: pct(
          observed.map((x) => x.elapsedMs),
          0.99,
        ),
      },
      failures,
      reconciliation: {
        mismatches: reconciliation.mismatches.length,
        clientMismatches: reconciliation.clientMismatches.length,
      },
      limits: [
        "Actual SMB/OneDrive unavailable; local shared filesystem only",
        "Replica counts equal the explicitly started independent local backend/data roots",

        "Latency is descriptive; no invented product SLO",
      ],
    };
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log("RESULT", JSON.stringify(result));
    if (result.status !== "passed") process.exitCode = 1;
  } catch (e) {
    stopping = true;
    endAt = Date.now();
    write({ type: "fatal", error: e.stack });
    R.fs.writeFileSync(
      R.path.join(root, "failure.json"),
      JSON.stringify(
        {
          error: e.stack,
          usersOpened: sessions.length,
          measurementAt,
          failures,
          capacityLimit,
          requestedUsers: users,
          requestedSeconds: seconds,
          backendInstances: runtime?.servers.length,
        },
        null,
        2,
      ),
    );
    if (capacityLimit && runtime) {
      try {
        await Promise.all(loopPromises);
        for (const session of sessions) {
          await session.page.locator("#kolTable").focus();
          await B.settle(session);
        }
        const reconciliation = await reconcile();
        R.fs.writeFileSync(
          R.path.join(root, "capacity-reconciliation.json"),
          JSON.stringify(reconciliation, null, 2),
        );
      } catch (error) {
        write({ type: "capacity-reconciliation-error", error: error.stack });
      }
    }
    for(const s of sessions)await stopCpuDiagnostic(s,'user-'+s.account.index+'-fatal');
    if(!traceStopped&&sessions[0]){await R.deadline(sessions[0].context.tracing.stop({path:R.path.join(root,'trace-failed.zip')}),'failure trace',10000).catch(error=>write({type:'trace-unavailable',error:error.message}));traceStopped=true;}
    console.error(e);
    process.exitCode = 1;
  } finally {
    stopping = true;
    clearInterval(monitor);
    clearInterval(observeTimer);
    clearInterval(minuteTimer);
    await browser?.close();
    if (runtime) for (const s of runtime.servers) await R.stopServer(s);
    console.log("ARTIFACTS", root);
  }
})();
