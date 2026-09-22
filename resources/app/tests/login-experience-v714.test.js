'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'giris.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const USER_ACCESS = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-access.js'), 'utf8');

test('v7.14 login autocomplete uses dedicated lightweight auth endpoint and race guards', () => {
  assert.match(SERVER, /app\.get\('\/api\/auth\/users\/suggest', userAccess\.suggestHandler\)/);
  assert.match(LOGIN, /fetch\('\/api\/auth\/users\/suggest\?q='/);
  assert.match(LOGIN, /SEARCH_DEBOUNCE_MS = 150/);
  assert.match(LOGIN, /SEARCH_LOADING_DELAY_MS = 200/);
  assert.match(LOGIN, /searchController\.abort\(\)/);
  assert.match(LOGIN, /const seq = \+\+requestSeq/);
  assert.match(LOGIN, /if \(seq !== requestSeq\)/);
});

test('v7.14 login user DTO is intentionally minimal and active-only', () => {
  assert.match(USER_ACCESS, /profile\.enabled !== false/);
  assert.match(USER_ACCESS, /\.slice\(0, 8\)/);
  const safeStart = USER_ACCESS.indexOf('function safeSuggestion(profile)');
  const safeEnd = USER_ACCESS.indexOf('function suggestionIndex', safeStart);
  const safe = USER_ACCESS.slice(safeStart, safeEnd);
  assert.match(safe, /loginName:/);
  assert.match(safe, /displayName:/);
  assert.doesNotMatch(safe, /mags:|mmygs:|buyingGroups:|roleLabel:|permissions:/);
  assert.match(USER_ACCESS, /foldLoginSearch/);
  assert.match(USER_ACCESS, /replace\(\/ö\/g, 'o'\)/);
});

test('v7.14 suggestions match Turkish/ascii variants, hide inactive users and do not call heavy data loaders', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-login-v714-'));
  try {
    const script = String.raw`
      const ua=require('./server/lib/user-access');
      let store=ua.loadStore();
      store.moderator.username='Gökberk'; store.moderator.displayName='Gökberk'; store.moderator.enabled=true;
      store.moderator.passwordHash=ua.hashPin('secret1'); store.moderator.pinHash=store.moderator.passwordHash;
      store.users=[
        {id:'u1',username:'Gökhan',displayName:'Gökhan Yılmaz',enabled:true,role:'buyer'},
        {id:'u2',username:'Fatih',displayName:'Fatih Avcı',enabled:true,role:'buyer'},
        {id:'u3',username:'Gökçe',displayName:'Gökçe Test',enabled:false,role:'buyer'}
      ];
      ua.saveStore(store,store._revision);
      let heavy=0;
      const access=ua.buildUserAccess({ensureDataLoaded:async()=>{heavy++;throw new Error('HEAVY_CALLED')},getOrders:()=>{heavy++;throw new Error('HEAVY_CALLED')}});
      const ask=q=>{let body;const res={set(){return this},json(v){body=v;return this}};access.suggestHandler({query:{q}},res);return body.users};
      console.log(JSON.stringify({ascii:ask('gok'),upper:ask('GÖK'),fatih:ask('avci'),heavy}));
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        BUYER_LOG_AUTH_DATA_ROOT: temp,
        BUYER_LOG_SERVER_DATA_ROOT: temp,
        BUYER_LOG_DATA_ROOT: path.join(temp, 'data'),
        BUYER_LOG_LOCAL_DATA_ROOT: path.join(temp, 'local'),
      },
    });
    const result = JSON.parse(output.trim());
    assert.deepEqual(result.ascii.map(item => item.loginName), ['Gökberk', 'Gökhan']);
    assert.deepEqual(result.upper.map(item => item.loginName), ['Gökberk', 'Gökhan']);
    assert.deepEqual(result.fatih.map(item => item.loginName), ['Fatih']);
    assert.equal(result.ascii.some(item => item.loginName === 'Gökçe'), false);
    assert.equal(result.heavy, 0);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test('v7.14 login supports keyboard, ARIA, password eye, last-user preference and inline errors', () => {
  assert.match(LOGIN, /role="combobox"/);
  assert.match(LOGIN, /aria-controls="suggestions"/);
  assert.match(LOGIN, /event\.key === 'ArrowDown'/);
  assert.match(LOGIN, /event\.key === 'ArrowUp'/);
  assert.match(LOGIN, /event\.key === 'Enter'/);
  assert.match(LOGIN, /event\.key === 'Escape'/);
  assert.match(LOGIN, /\$\('password'\)\.focus\(\)/);
  assert.match(LOGIN, /aria-pressed="false"/);
  assert.match(LOGIN, /buyerlog\.lastSuccessfulUsername/);
  assert.match(LOGIN, /class="errorBox"/);
  assert.doesNotMatch(LOGIN, /alert\(/);
});

test('v7.14 login button is never gated by Shared Sync and preserves 15 second credential recovery', () => {
  assert.match(LOGIN, /function loginGateReady\(\)[\s\S]{0,220}return true;/);
  assert.match(LOGIN, /const controlsLocked = loginBusy/);
  assert.match(LOGIN, /button\.disabled = controlsLocked \|\| !usernameReady \|\| !passwordReady/);
  assert.doesNotMatch(LOGIN, /Senkronizasyon bekleniyor/);
  assert.match(LOGIN, /LOGIN_TIMEOUT_MS = 15000/);
  assert.match(LOGIN, /setTimeout\(\(\) => controller\.abort\(\), LOGIN_TIMEOUT_MS\)/);
  assert.match(LOGIN, /void runUserBootstrap\(\)/);
  assert.match(LOGIN, /location\.replace\('\/'\)/);
  assert.match(LOGIN, /finally \{[\s\S]*loginBusy = false;[\s\S]*renderLoginButton\(\)/);
  assert.match(LOGIN, /Sunucu giriş isteğine zamanında yanıt vermedi\. Tekrar deneyin\./);
});

test('all valid local accounts can sign in independently of Shared Sync readiness', () => {
  const routeStart = SERVER.indexOf("app.post('/api/user-login'");
  const routeEnd = SERVER.indexOf("app.post('/api/user-logout'", routeStart);
  const route = SERVER.slice(routeStart, routeEnd);
  assert.match(route, /return userAccess\.loginHandler\(req, res, next\)/);
  assert.doesNotMatch(route, /BOOTSTRAP_IN_PROGRESS|BOOTSTRAP_NOT_READY|moderatorLocalLogin/);
  assert.match(LOGIN, /function loginGateReady\(\)[\s\S]{0,220}return true;/);
  assert.match(LOGIN, /hubStatus\.configured !== true \|\| !\['ready','offline'\]\.includes\(hubStatus\.status\)/);
  assert.match(LOGIN, /localOnly:true/);
});

test('v7.14 visual language is restrained ERP styling and responsive', () => {
  // Giriş ekranının vurgu rengi kendi tek seferlik değeri (#416b91) yerine
  // tasarım sisteminin --acc değerine hizalandı. İddia sabit bir hex'i değil,
  // bu hizalanmayı çiviliyor: design.css değişirse giriş ekranı da değişmeli.
  const accent = fs.readFileSync(path.join(ROOT, 'public', 'design.css'), 'utf8').match(/--acc:(#[0-9a-f]{6})/i);
  assert.ok(accent, 'tasarım sisteminde --acc tanımlı olmalı');
  assert.match(CSS, new RegExp(`--login-brand:${accent[1]}`, 'i'));
  assert.match(CSS, /max-width:440px/);
  assert.match(CSS, /\.suggestionAvatar/);
  assert.match(CSS, /@media\(max-width:820px\)/);
  assert.doesNotMatch(CSS, /linear-gradient|radial-gradient|backdrop-filter/);
});
