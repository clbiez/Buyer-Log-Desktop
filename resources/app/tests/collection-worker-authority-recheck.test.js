"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bl-worker-authority-")),
  env = {
    BUYER_LOG_SERVER_DATA_ROOT: path.join(root, "server"),
    BUYER_LOG_AUTH_DATA_ROOT: path.join(root, "server"),
    BUYER_LOG_DATA_ROOT: path.join(root, "app"),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, "local"),
    BUYER_LOG_CONFIG_PATH: path.join(root, "config.json"),
    BUYER_LOG_CENTRAL_IAM_ENABLED: "0",
  };
Object.assign(process.env, env);
const access = require("../server/lib/user-access"),
  store = require("../server/lib/collection-workspaces"),
  worker = require("../server/lib/collection-save-worker-client"),
  { withFileLeaseAsync } = require("../server/lib/shared-file-transaction");
test.after(async () => {
  await worker.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});
for (const mode of ["rows", "full"])
  test(
    mode + " save checks revoked actor after waiting on the real file lease",
    async () => {
      let directory = access.loadStore();
      directory.moderator.enabled = true;
      directory.moderator.status = "ACTIVE";
      access.saveStore(directory);
      const seeded = (
        await store.saveWorkspaceAsync(
          "moderator",
          { rows: [{ id: 1, not: "original" }], nextId: 2 },
          null,
        )
      ).saved;
      let unlock, entered;
      const held = new Promise((r) => (entered = r)),
        gate = new Promise((r) => (unlock = r)),
        lock = withFileLeaseAsync(
          store.workspaceFile("moderator"),
          async () => {
            entered();
            await gate;
          },
        );
      await held;
      const current = access.loadStore().moderator,
        body =
          mode === "rows"
            ? { upserts: [{ ...seeded.rows[0], not: "forbidden" }] }
            : { ...seeded, rows: [{ ...seeded.rows[0], not: "forbidden" }] };
      const pending = worker.runCollectionSave({
        ownerId: "moderator",
        body: Buffer.from(JSON.stringify(body)),
        mode,
        env,
        actorGuard: {
          actorId: "moderator",
          credentialRevision: current.credentialRevision || 1,
          centralIamEnabled: false,
        },
      });
      // Revocation is durable before the worker can acquire the held lease.
      directory = access.loadStore();
      directory.moderator.enabled = false;
      directory.moderator.status = "INACTIVE";
      access.saveStore(directory);
      unlock();
      await lock;
      await assert.rejects(
        pending,
        (e) => e.statusCode === 403 && e.code === "COLLECTION_EDIT_DENIED",
      );
      assert.deepEqual(store.loadWorkspace("moderator"), seeded);
    },
  );
test("native PATCH and PUT pass actor guards to the worker", () => {
  for (const file of [
    "server/server.js",
    "server/routes/oab-batch-routes.js",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(
      source,
      /actorGuard: \{ actorId:req\.currentUser\.id, credentialRevision:req\.currentUser\.credentialRevision \|\| 1, centralIamEnabled:userAccess\.centralIamHealth\(\)\.enabled \}/,
    );
  }
});
