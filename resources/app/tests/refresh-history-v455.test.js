'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HTML = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('v4.55 ASAS & ANTREPO history persists only the latest 10 records and supports clear all', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-history-v455-'));
  const script = `
    const db=require(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))});
    for(let i=0;i<12;i++){
      db.addRefreshHistory({
        id:'r'+i,
        createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),
        details:[{source:'ASAS',detail:'change '+i}],
        summary:{totalChanges:1}
      });
    }
    const kept=db.loadRefreshHistory();
    if(kept.items.length!==10)throw new Error('expected 10, got '+kept.items.length);
    if(kept.items[0].id!=='r11'||kept.items[9].id!=='r2')throw new Error('wrong retained range '+kept.items.map(x=>x.id).join(','));
    const raw=JSON.parse(require('fs').readFileSync(require('path').join(process.env.BUYER_LOG_SERVER_DATA_ROOT,'source-refresh-history.json'),'utf8'));
    if(raw.items.length!==10)throw new Error('older records were not deleted from disk');
    const cleared=db.clearRefreshHistory(kept._revision);
    if(cleared.items.length!==0)throw new Error('clear all failed');
    const reloaded=db.loadRefreshHistory();
    if(reloaded.items.length!==0)throw new Error('clear all was not persisted');
    process.stdout.write(JSON.stringify({limit:db.REFRESH_HISTORY_LIMIT,revision:reloaded._revision}));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: temp, BUYER_LOG_DATA_ROOT: path.join(temp, 'app') },
    encoding: 'utf8'
  });
  const result = JSON.parse(output);
  assert.equal(result.limit, 10);
});

test('v4.55 history modal includes Delete all and the server exposes a collection delete endpoint', () => {
  assert.ok(HTML.includes('id="sourceRefreshHistClearAll"'));
  assert.ok(HTML.includes('clearAllSourceRefreshHistory'));
  assert.match(SERVER, /app\.delete\('\/api\/refresh-history',/);
});
