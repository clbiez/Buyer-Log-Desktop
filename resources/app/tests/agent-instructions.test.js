'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..','..','..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('agent reference documents listed on demand exist in the repository',()=>{
  const doc=read('CLAUDE.md');
  const tail=doc.split('## 6 · On-demand referanslar')[1];
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

test('AGENTS.md stays short and self-sufficient; CLAUDE.md is opened per section',()=>{
  const a=read('AGENTS.md');
  assert.ok(Buffer.byteLength(a,'utf8')<4500,'AGENTS.md must stay a short fast path');
  assert.match(a,/yalnız ilgili bölümü aç/);
  assert.doesNotMatch(a,/CLAUDE\.md[^\n]*(tam oku|bir kez tam)/);
  for(const token of ['npm test -- <modül>','visual.kind="none"','L2','LCW_AI_ARCHITECTURE.md'])assert.ok(a.includes(token),'AGENTS.md missing: '+token);
});

test('CLAUDE.md keeps LCW AI detail on demand, tiered performance and filtered tests',()=>{
  const c=read('CLAUDE.md'),lcw=read('docs/ai/LCW_AI_ARCHITECTURE.md'),perf=read('docs/PERFORMANCE_ACCEPTANCE.md');
  assert.match(c,/docs\/ai\/LCW_AI_ARCHITECTURE\.md/);
  assert.doesNotMatch(c,/persist:buyerlog-lcwai-auth|buyerlog:render-pdf|export-document-palette/,'LCW AI detail belongs in docs/ai/LCW_AI_ARCHITECTURE.md');
  for(const token of ['persist:buyerlog-lcwai-auth','buyerlog:render-pdf','export-document-palette.json','registerContextProvider'])assert.ok(lcw.includes(token),'LCW AI doc missing: '+token);
  assert.match(c,/Tam `npm test` merge öncesinde bir kez/);
  assert.match(c,/compact-reporter\.js/);
  for(const token of ['N/A','L1','L2','Yükseltme'])assert.ok(c.includes(token)&&perf.includes(token),'performance tier missing: '+token);
  assert.match(perf,/## 0\. Kademe seçimi/);
  assert.match(c,/visual: \{ "kind": "none"/);
  // Birleştirilen bölümler tek başlık altında; eski ayrı §5/§6 başlıkları geri gelmez.
  assert.doesNotMatch(c,/## 5 · Token, süre|## 6 · Kanıt ile hedefin|### 1\.1 ·/);
  assert.match(read('.github/pull_request_template.md'),/Kademe \/ Tier: N\/A \| L1 \| L2/);
});
