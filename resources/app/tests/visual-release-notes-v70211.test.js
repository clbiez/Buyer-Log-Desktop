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
const SHARED=read('public/ui-components.css');
const NEXT=JSON.parse(read('public/release-notes/next.json'));
const CLAUDE=fs.readFileSync(path.join(ROOT,'..','..','CLAUDE.md'),'utf8');
const AGENTS=fs.readFileSync(path.join(ROOT,'..','..','AGENTS.md'),'utf8');
const TEST_WORKFLOW=fs.readFileSync(path.join(ROOT,'..','..','.github','workflows','buyerlog-test-release.yml'),'utf8');
const STABLE_WORKFLOW=fs.readFileSync(path.join(ROOT,'..','..','.github','workflows','buyerlog-promote-stable.yml'),'utf8');
const RELEASE_NOTES_SCRIPT=require('../scripts/release-notes.js');

test('visual release notes runtime is syntactically valid and loaded by shell',()=>{
  assert.doesNotThrow(()=>new Function(JS));
  assert.match(HTML,/release-notes\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(HTML,/release-notes\.js\?v=__BL_ASSET_VERSION__/);
});

test('release archive reuses Buyer Log guide and trivia component language',()=>{
  assert.match(CSS,/\.blRnCard\{display:grid/);
  assert.match(CSS,/\.blTriviaProgress/);
  assert.match(SHARED,/\.blRn[^}]*var\(--ui-accent\)/);
  assert.equal((CSS.match(/#[0-9a-fA-F]{3,8}\b/g)||[]).length,0);
});

test('users several stable versions behind receive cumulative chronological changes',()=>{
  assert.match(JS,/!last\|\|cmp\(e\.version,last\)>0/);
  assert.match(JS,/sort\(\(a,b\)=>cmp\(a\.version,b\.version\)\)/);
  assert.match(JS,/lastSeenStable/);
});

test('release archive sorts legacy two-part versions below newer semantic versions',()=>{
  const start=JS.indexOf('function versionParts(v){');
  const end=JS.indexOf('const ver=',start);
  assert.ok(start>=0&&end>start,'version comparator helpers must exist');
  const helpers=new Function(JS.slice(start,end)+';return {cmp,versionKey};')();
  assert.ok(helpers.cmp('7.0.213','7.137')>0,'7.0.213 must sort newer than historical 7.137');
  assert.ok(helpers.cmp('7.0.211','7.82')>0,'7.0.211 must sort newer than historical 7.82');
  assert.equal(helpers.versionKey('7.137'),'7.0.137');
  assert.equal(helpers.versionKey('7.0.137'),'7.0.137');
  assert.match(JS,/visual=new Set\(\(await loadIndex\(\)\)\.releases\.map\(x=>versionKey\(x\.version\)\)\)/);
});

test('release cards always expose readable copy, zoomable visuals and explicit navigation',()=>{
  assert.match(JS,/function description\(change,release\)/);
  assert.match(JS,/pick\(release\?\.summary\)/);
  assert.match(JS,/data-rn-zoom/);
  assert.match(JS,/openVisual\(/);
  assert.match(JS,/blRnNavBtn--next/);
  assert.match(SHARED,/\.blRnCopy \{[^}]*background:var\(--ui-surface\)/);
  assert.match(CSS,/\.blRnLightbox\{/);
  assert.match(CSS,/\.blRnZoomHint\{/);
  assert.match(CSS,/\.blRnNavBtn\{/);
});

test('pending release-note contract has bilingual detail and verified post-change PNG screenshots',()=>{
  if(!NEXT.changes.length){
    assert.equal(NEXT.publishedAt,'');
    return;
  }
  for(const change of NEXT.changes){
    for(const key of ['module','title','body']){
      assert.ok(change[key]?.tr?.trim(),key+' tr missing');
      assert.ok(change[key]?.en?.trim(),key+' en missing');
    }
    assert.ok(change.visual?.alt?.tr&&change.visual?.alt?.en);
    assert.ok(change.visual?.caption?.tr&&change.visual?.caption?.en);
    const asset=path.join(ROOT,'public','release-notes','next-assets',change.visual.src);
    assert.ok(fs.existsSync(asset));
    if(NEXT.bootstrapVisual===true){
      assert.ok(['screenshot','component-preview'].includes(change.visual?.kind));
    }else{
      assert.equal(change.visual?.kind,'screenshot');
      assert.equal(change.visual?.capture,'post-change');
      assert.match(change.visual?.src||'',/\.png$/i);
      assert.doesNotThrow(()=>RELEASE_NOTES_SCRIPT.inspectPngScreenshot(asset,change.visual.src));
    }
  }
});

test('release-note image guard detects archived corruption and unreadable crops',()=>{
  const good=path.join(ROOT,'public','release-notes','7.0.219','01-transit-date-type-fix.png');
  const truncated=path.join(ROOT,'public','release-notes','7.0.219','priority-checklist-rules.png');
  assert.doesNotThrow(()=>RELEASE_NOTES_SCRIPT.inspectPngScreenshot(good,'good screenshot'));
  assert.throws(()=>RELEASE_NOTES_SCRIPT.inspectPngScreenshot(truncated,'truncated screenshot'),/truncated|tamamlanmamış|CRC|piksel/i);
  assert.match(JS,/function screenshotDimensionsOk\(img\)/);
  assert.match(JS,/function bindScreenshotGuard\(stage,change,release\)/);
  assert.match(JS,/old or unverified screenshot|Eski veya doğrulanmamış ekran görüntüsü/);
});

test('Codex and Claude contracts require the same visual release-note workflow',()=>{
  assert.match(CLAUDE,/Görsel stable sürüm notları/);
  assert.match(CLAUDE,/release-notes\/next\.json/);
  assert.match(CLAUDE,/visual\.kind="screenshot"/);
  assert.match(CLAUDE,/visual\.capture="post-change"/);
  assert.match(CLAUDE,/kayıpsız PNG/);
  assert.match(AGENTS,/release-notes\/next\.json/);
  assert.match(AGENTS,/PNG ekran görüntüsü/);
});

test('TEST seals notes and STABLE promotion persists immutable archive',()=>{
  assert.match(TEST_WORKFLOW,/release:notes:seal/);
  assert.match(STABLE_WORKFLOW,/release-notes\.js seal "\$PROMOTE_VERSION" --reset/);
  assert.match(STABLE_WORKFLOW,/git push origin HEAD:main/);
});
