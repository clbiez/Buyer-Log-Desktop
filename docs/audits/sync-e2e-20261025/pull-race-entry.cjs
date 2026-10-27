"use strict";
// Timing barriers only; all reads, writes, accepts and replication remain native.
const fs = require("node:fs"),
  path = require("node:path"),
  root = path.dirname(process.env.BUYER_LOG_SERVER_DATA_ROOT),
  store = require("../../../resources/app/server/lib/collection-workspaces"),
  rep = require("../../../resources/app/server/lib/collection-replication");
async function hold(name) {
  fs.writeFileSync(path.join(root, name + "-entered"), "1");
  const start = Date.now();
  while (!fs.existsSync(path.join(root, name + "-release"))) {
    if (Date.now() - start > 25000)
      throw Error("Test barrier deadline: " + name);
    await new Promise((r) => setTimeout(r, 10));
  }
}
let pulled = false,
  published = false;
const replace = store.replaceWorkspaceReplica;
store.replaceWorkspaceReplica = async (...args) => {
  if (fs.existsSync(path.join(root, "race-armed")) && !pulled) {
    pulled = true;
    await hold("pull");
  }
  return replace(...args);
};
const create = rep.createCollectionReplication;
rep.createCollectionReplication = (options) => {
  const service = create(options),
    publish = service.publishOwner;
  service.publishOwner = async (owner) => {
    if (
      fs.existsSync(path.join(root, "race-armed")) &&
      !published &&
      store
        .loadWorkspace(owner)
        .rows.some((r) => r.modelKod === "ACCEPTED-LOCAL-NEW")
    ) {
      published = true;
      await hold("publish");
    }
    return publish(owner);
  };
  return service;
};
require("../../../resources/app/server/server.js");
