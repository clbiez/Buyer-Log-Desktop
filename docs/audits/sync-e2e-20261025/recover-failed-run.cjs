const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs");
const root = process.argv[2] || "/workspace/scratch/bl-final-50",
  out = R.path.join(root, "recovery-evidence");
R.fs.mkdirSync(out, { recursive: true });
(async () => {
  const flags=Object.fromEntries(process.argv.slice(3).map(x=>x.replace(/^--/,'').split('=')));
  const m = JSON.parse(R.fs.readFileSync(R.path.join(root, "manifest.json"))),
    f = JSON.parse(R.fs.readFileSync(R.path.join(root, "failure.json"))),
    ds = R.fs
      .readFileSync(R.path.join(root, "operations.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse),
    intents = new Map(
      ds.filter((x) => x.type === "intent").map((x) => [x.id, x]),
    ),
    requests = new Map(ds.filter(x=>x.type==='submitted').map(x=>[x.requestId,x])),
    expected = new Map();
  if(R.fs.existsSync(R.path.join(root,'failed-run-recovery.json')))throw Error('Completed recovery evidence already exists; preserve it and use the read-only audit-intents.py instead.');
  const resume=R.fs.existsSync(R.path.join(root,'pre-recovery-device-0.json'));
  if(resume&&!flags.resume)throw Error('Incomplete recovery snapshots exist; explicit --resume=1 preserves and reuses them.');
  const recoveryPortBase=Number(flags.port||m.port);
  for (const x of ds.filter(
    (x) => ["server-response","upstream-acceptance"].includes(x.type) && x.status === 200,
  )) {
    const i = intents.get(x.operationId);
    let request=requests.get(x.requestId);
    if(!request&&x.type==='upstream-acceptance'){
      const candidates=[...requests.values()].filter(r=>r.operationId===x.operationId&&r.user===x.user&&r.body?.upserts?.some(row=>String(row.id)===String(i?.rowId)&&row[i?.field]===i?.id));
      if(candidates.length===1)request=candidates[0];
    }
    const sent=request?.body?.upserts?.find(row=>String(row.id)===String(i?.rowId));
    if (
      request?.url==='/api/collection-workspaces/'+m.owner && sent?.[i?.field]===i?.id && i?.kind === "edit" &&
      x.data.applied?.some((a) => String(a.id) === String(i.rowId))
    )
      expected.set(String(i.rowId), {
        value: i.id,
        index: i.userIndex,
        at: x.at,
      });
  }
  const before = [];
  for (let i = 0; i < f.backendInstances; i++) {
    const p = R.path.join(
        root,
        "device-" + i,
        "server/collection-workspaces/" + m.owner + ".json",
      ),
      snapshot=R.path.join(root,"pre-recovery-device-"+i+".json"),
      w = JSON.parse(R.fs.readFileSync(resume?snapshot:p));
    if(!resume)R.fs.writeFileSync(snapshot,JSON.stringify(w,null,2));
    before.push({ index: i, workspace: w });
  }
  const ownMissing = [];
  for (const [id, e] of expected) {
    const w = before[e.index].workspace,
      row = w.rows.find((r) => String(r.id) === id);
    if (row?.modelKod !== e.value) {
      const newer = intents.get(row?.modelKod);
      if (!newer || newer.sentAt <= e.at)
        ownMissing.push({
          id,
          expected: e.value,
          actual: row?.modelKod,
          index: e.index,
        });
    }
  }
  const cold = [];
  for (let i = 0; i < f.backendInstances; i++) {
    let s;
    try {
      s = await R.startServer(
        R.path.join(root, "device-" + i),
        recoveryPortBase + i,
        m.hub,
      );
      const cookie = await R.login(s, m.accounts[i].id);
      const res = R.check(
        await R.api(s, "/api/collection-workspaces/" + m.owner, { cookie }),
      );
      cold.push({
        index: i,
        workspace: res.workspace,
        replication: res.replication,
      });
      R.fs.writeFileSync(
        R.path.join(root, "recovered-cold-device-" + i + ".json"),
        JSON.stringify(res, null, 2),
      );
    } finally {
      if (s) await R.stopServer(s);
    }
  }
  const coldMissing = [];
  for (const state of cold)
    for (const [id, e] of expected) {
      const row = state.workspace.rows.find((r) => String(r.id) === id);
      if (row?.modelKod !== e.value) {
        const newer = intents.get(row?.modelKod);
        if (!newer || newer.sentAt <= e.at)
          coldMissing.push({
            backend: state.index,
            id,
            expected: e.value,
            actual: row?.modelKod,
          });
      }
    }
  const op27 = ds.find(
    (x) => x.type === "server-response" && x.operationId === "op-20261025-27",
  );
  const result = {
    status: ownMissing.length || coldMissing.length ? "failed" : "passed",
    expectedAcceptedLatest: [...expected],
    ownMissing,
    coldMissing,
    rejectedOperation27: op27?.data.conflicts,
    serverCount: cold.length,
    runSource: m.source,
    recoveryPortBase,
    reusedOriginalPreRecoverySnapshots: resume,
    readMethod:
      "actual restarted native server GET, independent durable snapshots retained",
    source: require("child_process")
      .execSync("git rev-parse HEAD", { cwd: R.app })
      .toString()
      .trim(),
  };
  R.fs.writeFileSync(
    R.path.join(root, "failed-run-recovery.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  if (result.status !== "passed") process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
