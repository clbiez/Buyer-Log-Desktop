"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  assert = require("node:assert/strict"),
  root = process.argv[2] || "/workspace/scratch/bl-base-race";
let rt, peer;
(async () => {
  try {
    rt = await R.setup(root, {
      users: 2,
      backends: 2,
      startBackends: 1,
      port: 6610,
    });
    const m = rt.manifest,
      main = rt.servers[0],
      entry = R.path.join(__dirname, "base-race-entry.cjs");
    peer = await R.startServer(
      R.path.join(root, "device-1"),
      m.port + 1,
      m.hub,
      entry,
    );
    rt.servers[1] = peer;
    const mod = await R.login(main),
      pc = await R.login(peer, m.accounts[1].id);
    R.check(
      await R.api(peer, "/api/sync-settings", {
        method: "PUT",
        cookie: pc,
        body: { sharedSyncRoot: m.hub, syncPeriodMinutes: "manual" },
      }),
    );
    const base = R.check(
      await R.api(peer, "/api/collection-workspaces/" + m.owner, {
        cookie: pc,
      }),
    ).workspace;
    const remote = R.check(await R.api(main, "/api/collection-workspaces/" + m.owner, {cookie:mod})).workspace;
    R.check(await R.api(main, "/api/collection-workspaces/" + m.owner, {method:"PATCH",cookie:mod,body:{upserts:[{...remote.rows.find(r=>r.id===2),not:"REMOTE-OTHER-ACCEPTED"}]}}));
    R.fs.writeFileSync(R.path.join(peer.root, "base-race-armed"), "1");
    const pull = R.api(peer, "/api/collection-workspaces/" + m.owner, { cookie: pc });
    await R.until(() => R.fs.existsSync(R.path.join(peer.root, "state-entered")), { ms: 10000, label: "old remote read paused before base read" });
    const save = R.api(peer, "/api/collection-workspaces/" + m.owner, {
      method: "PATCH", cookie: pc,
      body: { upserts: [{ ...base.rows.find(r => r.id === 1), modelKod: "ACCEPTED-LOCAL-NEW" }], expectedExistingIds: ["1"] },
    });
    await R.until(() => JSON.parse(R.fs.readFileSync(R.path.join(peer.root, "server/collection-workspaces/" + m.owner + ".json"))).rows[0].modelKod === "ACCEPTED-LOCAL-NEW", { ms: 10000, label: "native local commit while stale sync is paused" });
    // Give the original implementation an opportunity to publish and advance the
    // base; the fixed owner queue deliberately waits behind the paused sync.
    await R.delay(700);
    const file = R.path.join(
        peer.root,
        "server/collection-workspaces/" + m.owner + ".json",
      ),
      committed = JSON.parse(R.fs.readFileSync(file));
    assert.equal(committed.rows[0].modelKod, "ACCEPTED-LOCAL-NEW");
    R.fs.writeFileSync(R.path.join(peer.root, "state-release"), "1");
    const pulled = await pull;

    const accepted = await save,
      after = R.check(
        await R.api(peer, "/api/collection-workspaces/" + m.owner, {
          cookie: pc,
        }),
      ).workspace;
    const evidence = {
      source: m.source,
      baseRevision: base._revision,
      committedBeforePull: committed.rows[0],
      pull: pulled,
      accepted,
      after: after.rows[0],
      afterRevision: after._revision,
    };
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(evidence, null, 2),
    );
    assert.equal(pulled.data.workspace.rows.find(r=>r.id===1).modelKod,"ACCEPTED-LOCAL-NEW","a stale remote envelope must not roll back a newer accepted/published local value");
    assert.equal(accepted.status, 200);
    assert.ok(accepted.data.applied.some((x) => x.id === "1"));
    assert.equal(
      after.rows[0].modelKod,
      "ACCEPTED-LOCAL-NEW",
      "an imported older snapshot must not overwrite the accepted local write",
    );
    const other = R.check(
      await R.api(main, "/api/collection-workspaces/" + m.owner, {
        cookie: mod,
      }),
    ).workspace;
    assert.equal(other.rows[0].modelKod, "ACCEPTED-LOCAL-NEW");
    console.log(
      "PASS controlled real backend stale-envelope/base advancement race",
    );
  } finally {
    if (peer) {
      R.fs.writeFileSync(R.path.join(peer.root, "state-release"), "1");
  
    }
    if (rt) for (const s of rt.servers) if (s) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
