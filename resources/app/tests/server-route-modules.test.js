'use strict';

/* server/routes/*.js mimari sözleşmesi.
   Route grupları server.js'ten birebir taşınır; bu test üç şeyi garanti eder:
   1) Modül yüklenir ve kayıt sırasında hata atmaz (sahte app ile gerçekten çalıştırılır).
   2) Kaydettiği route sayısı kaynaktaki app.METHOD( çağrılarıyla birebir aynıdır.
   3) Modülün beklediği HER bağımlılık server.js'teki kayıt çağrısında verilir —
      eksik bağımlılık ancak istek anında patlardı. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const ROUTES_DIR = path.join(SERVER_DIR, 'routes');
const SERVER = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
const modules = fs.existsSync(ROUTES_DIR) ? fs.readdirSync(ROUTES_DIR).filter(name => name.endsWith('.js')).sort() : [];

/* Her özelliği ve çağrısı kendini döndüren zararsız saplama: userAccess.requireCapability(...)
   gibi kayıt anındaki çağrılar çalışır, hiçbir G/Ç yapılmaz. */
function stub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : proxy),
    apply: () => proxy,
  });
  return proxy;
}

function recordingApp() {
  const routes = [];
  const app = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch', 'all', 'use']) {
    app[method] = (route, ...handlers) => {
      assert.ok(handlers.length > 0 || method === 'use', `${method} ${route} işleyicisiz`);
      routes.push(`${method.toUpperCase()} ${Array.isArray(route) ? route.join('|') : route}`);
    };
  }
  return { app, routes };
}

test('server/routes altında en az bir taşınmış route modülü var', () => {
  assert.ok(modules.length > 0);
});

for (const name of modules) {
  const source = fs.readFileSync(path.join(ROUTES_DIR, name), 'utf8');
  const exportName = (source.match(/module\.exports = function (\w+)\(app, deps\)/) || [])[1];

  test(`${name}: yüklenir, sahte app ile kaydolur ve route sayısı kaynağıyla aynıdır`, () => {
    assert.ok(exportName, 'module.exports = function registerX(app, deps) biçiminde olmalı');
    const register = require(path.join(ROUTES_DIR, name));
    const { app, routes } = recordingApp();
    const realSetInterval = global.setInterval;
    global.setInterval = () => ({ unref() {} }); // kayıt anındaki zamanlayıcılar testte kurulmaz
    try {
      register(app, new Proxy({}, { get: () => stub() }));
    } finally {
      global.setInterval = realSetInterval;
    }
    let declared = (source.match(/\bapp\.(?:get|post|put|delete|patch|use)\(/g) || []).length;
    if (name === 'agent-office-routes.js') {
      assert.match(source, /\[\['workbook',[\s\S]*\['merch-calendar',/);
      declared += 1; // two artifact types share one registration statement
    }
    if (name === 'view-profile-routes.js') {
      const expected = ['POST /api/choose-folder'];
      for (const route of ['views','filter-profiles']) expected.push(
        'GET /api/'+route, 'POST /api/'+route, 'PUT /api/'+route+'/:id',
        'DELETE /api/'+route+'/:id', 'POST /api/'+route+'/:id/favorite', 'POST /api/'+route+'/:id/use');
      assert.deepEqual([...routes].sort(), expected.sort());
      declared = expected.length;
    }
    assert.equal(routes.length, declared, `${routes.length} kayıt, kaynakta ${declared} route/middleware`);
    assert.equal(new Set(routes).size, routes.length, 'aynı route iki kez kaydedilmemeli');
  });

  test(`${name}: beklenen her bağımlılık server.js kayıt çağrısında verilir`, () => {
    const block = source.match(/const \{\n([\s\S]*?)\n\s*\} = deps;/);
    const expected = block ? block[1].split(',').map(item => item.trim()).filter(Boolean) : [];
    const getters = [...source.matchAll(/const (get\w+) = deps\.\1;/g)].map(match => match[1]);
    const moduleRef = `require('./routes/${name.replace(/\.js$/, '')}')(app,`;
    const start = SERVER.indexOf(moduleRef);
    assert.ok(start > 0, `server.js ${name} modülünü kaydetmiyor`);
    const objectStart = SERVER.indexOf('{', start);
    let depth = 0, end = objectStart;
    for (; end < SERVER.length; end++) {
      if (SERVER[end] === '{') depth++;
      if (SERVER[end] === '}' && --depth === 0) break;
    }
    const call = SERVER.slice(objectStart, end + 1);
    for (const dep of expected) assert.match(call, new RegExp(`(?:[{},]\\s*)${dep}\\s*(?:[:,}])`), `${dep} enjekte edilmiyor`);
    for (const getter of getters) assert.match(call, new RegExp(`\\n  ${getter}: \\(\\) => \\w+,`), `${getter} canlı okuyucu verilmiyor`);
    assert.doesNotMatch(source, /require\(['"]\.\.\/server['"]\)/, 'route modülü server.js\'i geri require etmemeli');
    /* server.js'te require edilen ve aynı adda Node globali de olan adlar (ör. crypto →
       WebCrypto) enjekte edilmezse modül SESSİZCE globali kullanır: crypto.createHash
       yoktur, uç 500 döner. Kullanılıyorsa bağımlılık listesinde olmak zorunda. */
    const shadowed = [...SERVER.matchAll(/^const (\w+) = require\(/gm)].map(match => match[1])
      .filter(name => Object.prototype.hasOwnProperty.call(globalThis, name));
    for (const name of shadowed) {
      if (new RegExp(`(^|[^.\\w])${name}\\.`, 'm').test(source)) {
        assert.ok(expected.includes(name), `${name} kullanılıyor ama enjekte edilmiyor (Node globali ${name} devreye girer)`);
      }
    }
    // server/routes/ altında ./lib ve __dirname yanlış klasöre çözülür (sunucu hiç açılmazdı).
    assert.doesNotMatch(source, /require\(['"]\.\/(?!\.)/, 'göreli require ../lib/... olmalı');
    assert.doesNotMatch(source, /__dirname|__filename/, '__dirname route modülünde server/ değil server/routes/ olur');
  });
}
