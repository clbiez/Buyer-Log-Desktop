"use strict";
const R = require("../../../resources/app/scripts/sync-e2e/runtime.cjs"),
  assert = require("node:assert/strict"),
  root = process.argv[2] || "/workspace/scratch/bl-pull-race";
let rt, peer;
(async () => {
  try {
    rt = await R.setup(root, {
      users: 2,
      backends: 2,
      startBackends: 1,
      port: 6600,
    });
    const m = rt.manifest,
      main = rt.servers[0],
      entry = R.path.join(__dirname, "pull-race-entry.cjs");
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
    for (let i = 0; i < 2; i++) {
      const w = R.check(
        await R.api(main, "/api/collection-workspaces/" + m.owner, {
          cookie: mod,
        }),
      ).workspace;
      R.check(
        await R.api(main, "/api/collection-workspaces/" + m.owner, {
          method: "PATCH",
          cookie: mod,
          body: {
            upserts: [
              { ...w.rows.find((r) => r.id === 2), not: "remote-other-" + i },
            ],
          },
        }),
      );
    }
    R.fs.writeFileSync(R.path.join(peer.root, "race-armed"), "1");
    const pull = R.api(peer, "/api/collection-workspaces/" + m.owner, {
      cookie: pc,
    });
    await R.until(
      () => R.fs.existsSync(R.path.join(peer.root, "pull-entered")),
      {
        ms: 10000,
        label: "pull read old local snapshot before workspace replace",
      },
    );
    const save = R.api(peer, "/api/collection-workspaces/" + m.owner, {
      method: "PATCH",
      cookie: pc,
      body: {
        upserts: [
          {
            ...base.rows.find((r) => r.id === 1),
            modelKod: "ACCEPTED-LOCAL-NEW",
          },
        ],
        expectedExistingIds: ["1"],
      },
    });
    await R.until(
      () => R.fs.existsSync(R.path.join(peer.root, "publish-entered")),
      { ms: 10000, label: "local real file committed before publication" },
    );
    const file = R.path.join(
        peer.root,
        "server/collection-workspaces/" + m.owner + ".json",
      ),
      committed = JSON.parse(R.fs.readFileSync(file));
    assert.equal(committed.rows[0].modelKod, "ACCEPTED-LOCAL-NEW");
    R.fs.writeFileSync(R.path.join(peer.root, "pull-release"), "1");
    const pulled = await pull;
    R.fs.writeFileSync(R.path.join(peer.root, "publish-release"), "1");
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
      "PASS controlled real backend pull/local commit/publication race",
    );
  } finally {
    if (peer) {
      R.fs.writeFileSync(R.path.join(peer.root, "pull-release"), "1");
      R.fs.writeFileSync(R.path.join(peer.root, "publish-release"), "1");
    }
    if (rt) for (const s of rt.servers) if (s) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
