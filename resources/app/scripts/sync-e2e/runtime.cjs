"use strict";
// Isolated production processes, real HTTP/auth/storage. No endpoint responses mocked.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawn, execFileSync } = require("node:child_process");
const app = path.resolve(__dirname, "../.."),
  password = "Synthetic-E2E-20261025";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(
  fn,
  { ms = 60000, interval = 200, label = "condition" } = {},
) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await delay(interval);
  }
  throw Error(label + " timeout" + (last ? ": " + last.message : ""));
}
async function deadline(promise, label, ms = 30000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error(label + " deadline " + ms + "ms")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function envFor(root, port, hub) {
  const env = {
    ...process.env,
    BUYER_LOG_CENTRAL_IAM_ENABLED: hub ? "1" : "0",
    BUYER_LOG_CONFIG_PATH: path.join(root, "config.json"),
  };
  for (const [key, dir] of Object.entries({
    BUYER_LOG_DATA_ROOT: "app",
    BUYER_LOG_SERVER_DATA_ROOT: "server",
    BUYER_LOG_LOCAL_DATA_ROOT: "local",
    BUYER_LOG_TEMP_ROOT: "temp",
    BUYER_LOG_AUTH_DATA_ROOT: "server",
  })) {
    env[key] = path.join(root, dir);
    fs.mkdirSync(env[key], { recursive: true });
  }
  fs.mkdirSync(path.join(root, "source"), { recursive: true });
  fs.writeFileSync(
    env.BUYER_LOG_CONFIG_PATH,
    JSON.stringify({
      port,
      host: "127.0.0.1",
      sourceFolder: path.join(root, "source"),
      centralIamEnabled: !!hub,
    }),
  );
  if (hub)
    fs.writeFileSync(
      path.join(root, "local/sync-settings.json"),
      JSON.stringify({ sharedSyncRoot: hub, syncPeriodMinutes: "manual" }),
    );
  return env;
}
async function startServer(root, port, hub, entry = "server/server.js") {
  const env = envFor(root, port, hub),
    file = path.join(root, "server.log"),
    offset = fs.existsSync(file) ? fs.statSync(file).size : 0,
    fd = fs.openSync(file, "a");
  const child = spawn(process.execPath, [entry], {
    cwd: app,
    env,
    stdio: ["ignore", fd, fd],
  });
  fs.closeSync(fd);
  const server = {
      root,
      port,
      hub,
      child,
      env,
      base: `http://127.0.0.1:${port}`,
    },
    start = Date.now();
  while (Date.now() - start < 60000) {
    if (child.exitCode !== null)
      throw Error(
        "Own backend exited " +
          child.exitCode +
          " on " +
          port +
          "; existing listener is not accepted as test backend",
      );
    const ownLog = fs.readFileSync(file).subarray(offset).toString();
    if (ownLog.includes("SERVER_READY")) {
      try {
        const res = await fetch(server.base + "/api/auth-status");
        if (res.status === 200) return server;
      } catch {}
    }
    await delay(100);
  }
  await stopServer(server);
  throw Error("Own backend readiness timeout on " + port);
}
async function stopServer(s) {
  if (!s?.child || s.child.exitCode !== null) return;
  const done = new Promise((r) => s.child.once("exit", r));
  s.child.kill("SIGTERM");
  await Promise.race([done, delay(10000)]);
  if (s.child.exitCode === null) s.child.kill("SIGKILL");
}
async function api(
  s,
  url,
  { method = "GET", body, cookie, headers = {} } = {},
) {
  const res = await fetch(s.base + url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw: raw.slice(0, 600) };
  }
  return {
    status: res.status,
    data,
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(s, userId = "moderator") {
  return until(
    async () => {
      const r = await api(s, "/api/user-login", {
        method: "POST",
        body: { userId, password, newPassword: password },
      });
      if (r.status === 200) return r.cookie;
    },
    { label: "login " + userId },
  );
}
function check(r, expected = 200) {
  if (r.status !== expected)
    throw Error("HTTP " + r.status + " " + JSON.stringify(r.data));
  return r.data;
}
async function setup(
  root,
  { users = 50, backends = 3, port = 6520, startBackends = backends } = {},
) {
  if (fs.existsSync(path.join(root, "device-0")))
    throw Error(
      "Use a new empty isolated evidence root; existing test data is preserved.",
    );
  fs.mkdirSync(root, { recursive: true });
  const hub = path.join(root, "hub");
  fs.mkdirSync(hub, { recursive: true });
  const servers = [];
  try {
    const first = await startServer(path.join(root, "device-0"), port);
    servers.push(first);
    let moderator = await login(first);
    const accounts = [];
    for (let i = 0; i < users; i++) {
      const username = "E2E Buyer " + String(i + 1).padStart(2, "0");
      const d = check(
        await api(first, "/api/users", {
          method: "POST",
          cookie: moderator,
          body: {
            username,
            displayName: username,
            title: "Synthetic buyer",
            password,
            systemRole: "buyer",
            managerId: "moderator",
          },
        }),
        201,
      );
      accounts.push({ index: i, id: d.user.id, username });
    }
    check(
      await api(first, "/api/shared-hub/initialize", {
        method: "POST",
        cookie: moderator,
        body: { root: hub, confirmCritical: true },
      }),
    );
    first.hub = hub;
    moderator = await login(first);
    const owner = accounts[0].id;
    for (const a of accounts.slice(1))
      check(
        await api(first, "/api/collection-permissions/" + a.id, {
          method: "PUT",
          cookie: moderator,
          body: { ownerId: owner, level: "edit" },
        }),
      );
    check(
      await api(first, "/api/collection-permissions/moderator", {
        method: "PUT",
        cookie: moderator,
        body: { ownerId: owner, level: "edit" },
      }),
    );
    const rows = accounts.map((a, i) => ({
      id: i + 1,
      modelKod: "SYNTHETIC-" + String(i + 1).padStart(3, "0"),
      plmId: "SYN-" + i,
      season: "W26",
      country: "China",
      lisans: "E2E LICENSE",
      licensor: "E2E LICENSOR",
      qty: 100,
      not: "initial",
      pricing: { "Demo Supplier": "4" },
      confirmedManufacturer: "Demo Supplier",
      trPrice: "400",
      trFx: "",
      exFactory: "2026-10-25",
    }));
    check(
      await api(first, "/api/collection-workspaces/" + owner, {
        method: "PUT",
        cookie: moderator,
        body: {
          rows,
          manufacturers: [{name:"Demo Supplier",email:""}],
          customColumns: [],
          nextId: 1000,
          expectedRevision: 0,
        },
      }),
    );
    check(
      await api(first, "/api/pricing-rules", {
        method: "PUT",
        cookie: moderator,
        body: {
          rules: [
            {
              id: "e2e-rule",
              license: "E2E LICENSE",
              licensor: "E2E LICENSOR",
              royalty: 20,
              trCommission: 2,
              ydCommission: 3,
              hologramCost: 0.01,
              opdStart: "2026-01-01",
              seasons: [],
            },
          ],
        },
      }),
    );
    check(
      await api(first, "/api/fx", {
        method: "PUT",
        cookie: moderator,
        body: {
          base: "USD",
          months: { "2026-09": { TRY: 40 }, "2026-10": { TRY: 42 } },
        },
      }),
    );
    check(
      await api(first, "/api/shared-hub/publish-master", {
        method: "POST",
        cookie: moderator,
        body: {},
      }),
    );
    for (let i = 1; i < startBackends; i++) {
      const s = await startServer(
        path.join(root, "device-" + i),
        port + i,
        hub,
      );
      servers.push(s);
      const c = await login(s, accounts[i].id);
      check(
        await api(s, "/api/sync-settings", {
          method: "PUT",
          cookie: c,
          body: { sharedSyncRoot: hub, syncPeriodMinutes: "manual" },
        }),
      );
    }
    const manifest = {
      root,
      hub,
      users,
      backends,
      port,
      owner,
      accounts,
      source: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: app,
        encoding: "utf8",
      }).trim(),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    return { servers, manifest };
  } catch (e) {
    for (const s of servers) await stopServer(s);
    throw e;
  }
}
async function attach(root) {
  const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json")),
    ),
    servers = [];
  for (let i = 0; i < manifest.backends; i++)
    servers.push(
      await startServer(
        path.join(root, "device-" + i),
        manifest.port + i,
        manifest.hub,
      ),
    );
  return { servers, manifest };
}
module.exports = {
  deadline,
  fs,
  path,
  os,
  app,
  password,
  delay,
  until,
  api,
  login,
  check,
  startServer,
  stopServer,
  setup,
  attach,
};
