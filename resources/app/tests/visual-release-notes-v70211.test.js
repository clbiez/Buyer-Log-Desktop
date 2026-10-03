'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const JS=read('public/release-notes.js');
const CSS=read('public/release-notes.css');
const HTML=read('public/index.html');
const NEXT=JSON.parse(read('public/release-notes/next.json'));
const CLAUDE=fs.readFileSync(path.join(ROOT,'..','..','CLAUDE.md'),'utf8');
const AGENTS=fs.readFileSync(path.join(ROOT,'..','..','AGENTS.md'),'utf8');
const TEST_WORKFLOW=fs.readFileSync(path.join(ROOT,'..','..','.github','workflows','buyerlog-test-release.yml'),'utf8');
const STABLE_WORKFLOW=fs.readFileSync(path.join(ROOT,'..','..','.github','workflows','buyerlog-promote-stable.yml'),'utf8');

test('visual release notes runtime is syntactically valid and loaded by shell',()=>{
  assert.doesNotThrow(()=>new Function(JS));
  assert.match(HTML,/release-notes\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(HTML,/release-notes\.js\?v=__BL_ASSET_VERSION__/);
});

test('release archive reuses Buyer Log guide and trivia component language',()=>{
  assert.match(CSS,/\.blRnCard\{display:grid/);
  assert.match(CSS,/\.blTriviaProgress/);
  assert.match(CSS,/var\(--acc\)/);
  assert.equal((CSS.match(/#[0-9a-fA-F]{3,8}\b/g)||[]).length,0);
});

test('users several stable versions behind receive cumulative chronological changes',()=>{
  assert.match(JS,/!last\|\|cmp\(e\.version,last\)>0/);
  assert.match(JS,/sort\(\(a,b\)=>cmp\(a\.version,b\.version\)\)/);
  assert.match(JS,/lastSeenStable/);
});

test('release cards always expose readable copy, zoomable visuals and explicit navigation',()=>{
  assert.match(JS,/function description\(change,release\)/);
  assert.match(JS,/pick\(release\?\.summary\)/);
  assert.match(JS,/data-rn-zoom/);
  assert.match(JS,/openVisual\(/);
  assert.match(JS,/blRnNavBtn--next/);
  assert.match(CSS,/\.blRnCopy\{[^}]*background:var\(--card\)/);
  assert.match(CSS,/\.blRnLightbox\{/);
  assert.match(CSS,/\.blRnZoomHint\{/);
  assert.match(CSS,/\.blRnNavBtn\{/);
});

test('pending release-note contract has bilingual detail and a visual for every change',()=>{
  assert.ok(NEXT.changes.length>=2);
  for(const change of NEXT.changes){
    for(const key of ['module','title','body']){
      assert.ok(change[key]?.tr?.trim(),key+' tr missing');
      assert.ok(change[key]?.en?.trim(),key+' en missing');
    }
    assert.ok(change.visual?.src);
    assert.ok(change.visual?.alt?.tr&&change.visual?.alt?.en);
    assert.ok(change.visual?.caption?.tr&&change.visual?.caption?.en);
    assert.ok(fs.existsSync(path.join(ROOT,'public','release-notes','next-assets',change.visual.src)));
  }
});

test('Codex and Claude contracts require the same visual release-note workflow',()=>{
  assert.match(CLAUDE,/Görsel stable sürüm notları/);
  assert.match(CLAUDE,/release-notes\/next\.json/);
  assert.match(CLAUDE,/visual\.kind="screenshot"/);
  assert.match(AGENTS,/release-notes\/next\.json/);
});

test('TEST seals notes and STABLE promotion persists immutable archive',()=>{
  assert.match(TEST_WORKFLOW,/release:notes:seal/);
  assert.match(STABLE_WORKFLOW,/release-notes\.js seal "\$PROMOTE_VERSION" --reset/);
  assert.match(STABLE_WORKFLOW,/git push origin HEAD:main/);
});
