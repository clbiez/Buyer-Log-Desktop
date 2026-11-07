'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
function run(detailsLength, detailsTotal) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-history-idempotent-'));
  try {
    const script = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs'), path = require('node:path');
      const db = require(${JSON.stringify(path.join(ROOT, 'server/db.js'))});
      const file = path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, 'source-refresh-history.json');
      const item = { id:'demo-history', createdAt:'2026-11-05T12:00:00.000Z',
        details:Array.from({length:${detailsLength}}, (_,i)=>({source:'ASAS',detail:'demo '+i})),
        detailsTotal:${JSON.stringify(detailsTotal)}, summary:{totalChanges:30000} };
      const initial = {items:[item],_revision:7,_updatedAt:'2026-11-05T12:00:01.000Z'};
      fs.writeFileSync(file, JSON.stringify(initial));
      const first = db.loadRefreshHistory();
      assert.equal(first.items[0].details.length, Math.min(${detailsLength}, db.REFRESH_HISTORY_DETAIL_LIMIT));
      assert.equal(first.items[0].detailsTotal, 30000);
      assert.deepEqual(first.items[0].summary, item.summary);
      const bytes = fs.readFileSync(file), stat = fs.statSync(file, {bigint:true});
      for(let i=0;i<3;i++) {
        const next = db.loadRefreshHistory();
        assert.equal(next._revision, first._revision, 'a read of normalized history must not advance its revision');
        assert.equal(next._updatedAt, first._updatedAt);
        assert.deepEqual(next.items, first.items);
        assert.deepEqual(fs.readFileSync(file), bytes, 'read must preserve disk bytes');
        assert.equal(fs.statSync(file, {bigint:true}).mtimeNs, stat.mtimeNs, 'read must not rewrite the file');
      }
      const saved = db.addRefreshHistory({id:'new-demo',createdAt:'2026-11-06T12:00:00.000Z',details:[{detail:'new'}]});
      assert.equal(saved.id, 'new-demo');
      const changed = db.loadRefreshHistory();
      assert.equal(changed._revision, first._revision+1, 'a real change still persists exactly one revision');
      assert.equal(changed.items[0].id, 'new-demo');
      assert.equal(changed.items[1].detailsTotal, 30000);
      process.stdout.write(JSON.stringify({revision:first._revision,updatedAt:first._updatedAt}));
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], {
      cwd:ROOT, encoding:'utf8',
      env:{...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED:'0', BUYER_LOG_SERVER_DATA_ROOT:root,
        BUYER_LOG_AUTH_DATA_ROOT:root, BUYER_LOG_DATA_ROOT:path.join(root,'app'),
        BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local')},
    }));
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
}

test('reading already-trimmed history preserves revision, timestamp and file bytes', () => {
  const result = run(1000, 30000);
  assert.equal(result.revision, 7);
  assert.equal(result.updatedAt, '2026-11-05T12:00:01.000Z');
});

test('oversized legacy history is trimmed once and keeps the original total', () => {
  assert.equal(run(30000, 30000).revision, 8);
});

test('a legacy string total is normalized once without repeated writes', () => {
  assert.equal(run(1000, '30000').revision, 8);
});
