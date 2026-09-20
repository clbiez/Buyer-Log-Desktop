'use strict';
// Manual browser E2E harness: real IAM handlers and shipped User Management UI,
// isolated temporary accounts/shared folder; no production data or config.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-browser-'));
Object.assign(process.env, { BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'auth'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: path.join(root, 'shared') });
fs.mkdirSync(process.env.BUYER_LOG_AUTH_DATA_ROOT); fs.mkdirSync(process.env.BUYER_LOG_IAM_SHARED_ROOT);
const iam = require('../../server/lib/iam-core');
const salt = crypto.randomBytes(16), passwordHash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Browser-test-123', salt, 32).toString('hex')}`;
fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(iam.migrateStore({ _revision: 1, users: [], moderator: {
  id: 'moderator', username: 'admin', displayName: 'Test Administrator', title: 'Moderator', role: 'moderator', enabled: true, passwordHash, pinHash: passwordHash,
} })));
const express = require('express'), access = require('../../server/lib/user-access');
const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
const app = express(); app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public'), { index: false }));
app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="design.css"><link rel="stylesheet" href="user-management.css"></head><body><main><h1>Isolated IAM browser test</h1><form id="login"><label>Username<input name="username" value="admin"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form><p id="result"></p><button id="manage" hidden>User Management</button></main><script>var appLang='en';function showToast(m){document.getElementById('result').textContent=m;}document.getElementById('login').onsubmit=async function(e){e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})});const d=await r.json();if(r.ok){window.BL_USER_CONTEXT=d.user;document.getElementById('manage').hidden=false;document.getElementById('login').hidden=true;showToast('Signed in');}else showToast(d.error);};document.getElementById('manage').onclick=()=>window.BLUserManagement.open();</script><script src="user-management.js"></script></body></html>`));
app.use(runtime.requireSelection);
app.post('/api/user-login', runtime.loginHandler);
app.get('/api/current-user', runtime.currentHandler);
app.get('/api/users/admin', runtime.requireUserAdmin, runtime.adminListHandler);
app.post('/api/users', runtime.requireUserAdmin, runtime.adminCreateHandler);
app.put('/api/users/:id', runtime.requireUserAdmin, runtime.adminUpdateHandler);
app.get('/api/iam/migration/dry-run', runtime.requireModerator, runtime.iamDryRunHandler);
app.post('/api/iam/initialize', runtime.requireModerator, runtime.iamInitializeHandler);
app.post('/api/iam/refresh', runtime.requireUserAdmin, runtime.iamRefreshHandler);
app.get('/api/iam/health', runtime.iamHealthHandler);
app.put('/api/iam/roles', runtime.requireCapability('ROLE.MANAGE'), runtime.roleMatrixUpdateHandler);
app.post('/api/iam/users/bulk', runtime.requireUserAdmin, runtime.adminBulkHandler);
app.post('/api/iam/permissions/copy', runtime.requireCapability('USER.GRANT'), runtime.permissionCopyHandler);
const server = app.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, pid: process.pid })));
function close() { server.closeAllConnections(); server.close(() => { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }); }
process.stdin.resume(); process.stdin.on('data', close); process.on('SIGTERM', close); process.on('SIGINT', close);
