'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

function functionBody(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const brace = SRC.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let templateDepth = 0;
  let escaped = false;
  for (let i = brace; i < SRC.length; i += 1) {
    const ch = SRC[i];
    const next = SRC[i + 1];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (quote === '`' && ch === '$' && next === '{') { templateDepth += 1; i += 1; continue; }
      if (quote === '`' && ch === '}' && templateDepth > 0) { templateDepth -= 1; continue; }
      if (ch === quote && templateDepth === 0) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') {
      i = SRC.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = SRC.indexOf('*/', i + 2);
      if (i < 0) break;
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SRC.slice(brace + 1, i);
    }
  }
  throw new Error(`${name} gövdesi çözülemedi`);
}

test('v4.60 Quotation Price change yanında blur ile de commit edilir', () => {
  assert.match(SRC, /input\.addEventListener\('change',\(\)=>qCommitPriceInput\(req,input\)\)/);
  assert.match(SRC, /input\.addEventListener\('blur',\(\)=>qCommitPriceInput\(req,input\)\)/);
  assert.match(SRC, /input\.dataset\.lastCommitted=input\.value/);
  assert.match(SRC, /raw===last/);
});

test('v4.60 modal içindeki başka yere tıklamadan önce aktif fiyat hücresi kaydedilir', () => {
  assert.match(SRC, /modal\.addEventListener\('pointerdown',[\s\S]*qCommitActivePriceInput\(qActiveRequest\(\),modal\)[\s\S]*,\s*true\)/);
  assert.match(SRC, /nav\.addEventListener\('click',[\s\S]*qCommitActivePriceInput\(qActiveRequest\(\),modal\)/);
});

test('v4.60 quotation kapanmadan önce fiyat kayıt kuyruğu tamamlanır', () => {
  const body = functionBody('qChangeStatus');
  const commit = body.indexOf('qCommitActivePriceInput');
  const flush = body.indexOf('await qFlushSaves()');
  const patch = body.indexOf("/status`,{method:'PATCH'");
  assert.ok(commit >= 0 && flush > commit && patch > flush,
    'aktif hücre commit edilmeli, PUT kuyruğu bitmeli, ardından status PATCH çalışmalı');
});

test('v4.60 quotation kapatma Koleksiyon veya Pricing History verisini doğrudan değiştirmez', () => {
  const body = functionBody('qChangeStatus');
  assert.doesNotMatch(body, /qWritePriceToCollection|qRefreshCollection|confirmedManufacturer|row\.pricing/);
  const historyBody = functionBody('qhCollect');
  assert.doesNotMatch(historyBody, /req\.status|status\s*===\s*['"]active|status\s*!==\s*['"]closed/);
  assert.match(historyBody, /qLoad\(\)\.requests\.forEach/);
});

test('v4.60 sunucuda status değişimi fiyat, onay ve satır içeriğini aynen korur', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-quotation-close-'));
  const script = `
    const store=require(${JSON.stringify(path.join(ROOT, 'server', 'lib', 'quotations-store.js'))});
    const profile={id:'buyer-1',displayName:'Buyer One',username:'buyer1',role:'buyer'};
    const created=store.createRequest(profile,{
      id:'q-v460',source:'collection',
      manufacturers:[{name:'Factory A',email:'a@example.com'}],
      items:[{id:'line-1',modelKey:'kol:41',rowId:41,modelCode:'MODEL A',plmId:'PLM-1',
        manufacturer:'Factory A',manufacturerEmail:'a@example.com',price:'12.50',
        approved:true,dropped:false,targetPrice:'12.00'}]
    });
    const closed=store.setStatus(profile,created.id,'closed');
    const loaded=store.loadStore().requests.find(r=>r.id===created.id);
    require('fs').writeSync(1,JSON.stringify({closed,loaded}));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: temp },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const { closed, loaded } = JSON.parse(result.stdout);
  for (const request of [closed, loaded]) {
    assert.equal(request.status, 'closed');
    assert.equal(request.items.length, 1);
    assert.equal(request.items[0].price, '12.50');
    assert.equal(request.items[0].approved, true);
    assert.equal(request.items[0].manufacturer, 'Factory A');
    assert.equal(request.items[0].modelKey, 'kol:41');
  }
});
