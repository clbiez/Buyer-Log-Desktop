'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..','..','..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('agent reference documents listed on demand exist in the repository',()=>{
  const doc=read('CLAUDE.md');
  const tail=doc.split('## 8 · On-demand referanslar')[1];
  assert.ok(tail,'on-demand references section missing');
  const refs=[...tail.matchAll(/^- `([^`]+)`/gm)].map(x=>x[1]);
  assert.ok(refs.length>=4);
  for(const file of refs)assert.ok(fs.existsSync(path.join(ROOT,file)),'missing reference: '+file);
  assert.doesNotMatch(doc,/BUYER_LOG_CODEBASE_MAP\.md|BUYER_LOG_AGENT_REFERENCE\.md|DATA_ARCHITECTURE\.md/);
});

test('Claude and Codex share evidence, PR gates and honest release reporting',()=>{
  const c=read('CLAUDE.md'),a=read('AGENTS.md');
  for(const token of ['Kanıta dayalı eleştirel','P0','P1','P2','P3','buyerlog-pr-fast-checks.yml','TR/EN dil desteği','release-notes/next.json']){
    assert.ok(c.includes(token),'contract missing: '+token);
  }
  for(const token of ['CLAUDE.md','PNG ekran görüntüsü','PR/merge/TEST/STABLE']){
    assert.ok(a.includes(token),'Codex fast path missing: '+token);
  }
});

test('lightweight PR checks are distinct from manual full regression',()=>{
  const y=read('.github/workflows/buyerlog-pr-fast-checks.yml');
  assert.match(y,/pull_request:/);
  assert.match(y,/agent-instructions\.test\.js/);
  assert.match(y,/i18n-coverage-guard\.test\.js/);
  assert.match(y,/visual-release-notes-v70211\.test\.js/);
  const full=read('.github/workflows/buyerlog-tests.yml');
  assert.match(full,/workflow_dispatch:/);
  assert.doesNotMatch(full,/pull_request:/);
});
