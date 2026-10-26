"use strict";
const R = require("./runtime.cjs"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process");
(async () => {
  const root = process.argv[2];
  let runtime, locker;
  try {
    runtime = await R.setup(root, { users: 2, backends: 1 });
    const {
        servers: [s],
        manifest: m,
      } = runtime,
      mod = await R.login(s),
      buyer = await R.login(s, m.accounts[1].id),
      file = R.path.join(
        s.root,
        "server/collection-workspaces/" + m.owner + ".json",
      ),
      held = R.path.join(root, "held");
    const code = `const fs=require('fs');require('./server/lib/shared-file-transaction').withFileLeaseAsync(process.argv[1],async()=>{fs.writeFileSync(process.argv[2],'held');await new Promise(r=>process.on('message',r));}).then(()=>process.exit());`;
    locker = spawn(process.execPath, ["-e", code, file, held], {
      cwd: R.app,
      env: s.env,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    await R.until(() => R.fs.existsSync(held));
    const current = R.check(
      await R.api(s, "/api/collection-workspaces/" + m.owner, {
        cookie: buyer,
      }),
    ).workspace;
    let completed = false;
    const pending = R.api(s, "/api/collection-workspaces/" + m.owner, {
      method: "PATCH",
      cookie: buyer,
      body: { upserts: [{ ...current.rows[1], modelKod: "REVOKED-WRITE" }] },
    }).finally(() => (completed = true));
    await R.delay(700);
    assert.equal(
      completed,
      false,
      "mutation must be waiting behind real workspace lease",
    );
    const unrelatedStarted = Date.now();
    const unrelated = await R.deadline(
      R.api(s, "/api/collection-workspaces/" + m.accounts[1].id, {
        method: "PATCH",
        cookie: buyer,
        body: {
          upserts: [{ id: 1, modelKod: "UNRELATED-WORKSPACE" }],
          expectedNewIds: ["1"],
        },
      }),
      "unrelated workspace while lease held",
      5000,
    );
    assert.equal(unrelated.status, 200);
    assert.equal(
      completed,
      false,
      "blocked owner must still wait while unrelated owner commits",
    );
    R.fs.writeFileSync(
      R.path.join(root, "blocking-isolation.json"),
      JSON.stringify(
        {
          unrelatedLatencyMs: Date.now() - unrelatedStarted,
          heldOwner: m.owner,
          unrelatedOwner: m.accounts[1].id,
          result: unrelated,
        },
        null,
        2,
      ),
    );
    R.check(
      await R.api(s, "/api/collection-permissions/" + m.accounts[1].id, {
        method: "DELETE",
        cookie: mod,
        body: { ownerId: m.owner },
      }),
    );
    locker.send("release");
    const result = await pending;
    R.fs.writeFileSync(
      R.path.join(root, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log("RESULT", JSON.stringify(result));
    assert.equal(
      result.status,
      403,
      "waiting operation must recheck revoked authority",
    );
    assert.equal(
      JSON.parse(R.fs.readFileSync(file)).rows[1].modelKod,
      current.rows[1].modelKod,
    );
  } finally {
    locker?.kill();
    if (runtime) for (const s of runtime.servers) await R.stopServer(s);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
