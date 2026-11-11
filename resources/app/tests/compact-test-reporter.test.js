'use strict';
// npm test varsayılan kompakt çıktı sözleşmesi: geçen testler ve console gürültüsü
// yazılmaz; başarısız test dosya:satır + hata ile, başarısız dosyanın çıktısı ve özet yazılır.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const REPORTER=path.join(__dirname,'compact-reporter.js');

test('compact reporter prints only failures, failing-file output and a summary',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compact-'));
  try{
    fs.writeFileSync(path.join(dir,'pass.test.js'),"require('node:test')('quiet pass',()=>{console.log('PASS_NOISE');});\n");
    fs.writeFileSync(path.join(dir,'fail.test.js'),"const t=require('node:test');t.describe('grp',()=>{t('broken case',()=>{console.error('FAIL_CONTEXT');require('node:assert').equal(1,2);});t('fine',()=>{});});\n");
    fs.writeFileSync(path.join(dir,'crash.test.js'),"throw new Error('LOAD_CRASH');\n");
    const r=spawnSync(process.execPath,['--test','--test-reporter='+REPORTER,'pass.test.js','fail.test.js','crash.test.js'],{cwd:dir,encoding:'utf8',env:(({NODE_TEST_CONTEXT,...rest})=>rest)(process.env)});
    const out=r.stdout+r.stderr;
    assert.notEqual(r.status,0,'failing tests must keep a non-zero exit code');
    assert.match(out,/✖ broken case \(fail\.test\.js:1:\d+\)/);
    assert.match(out,/1 == 2/);
    assert.match(out,/FAIL_CONTEXT/);
    assert.match(out,/LOAD_CRASH/);
    assert.match(out,/tests 4 · pass 2 · fail 2/);
    assert.doesNotMatch(out,/PASS_NOISE|quiet pass|✖ grp/);
    assert.doesNotMatch(out,/node:internal/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('npm test defaults to the compact reporter and keeps a verbose escape hatch',()=>{
  const src=fs.readFileSync(path.join(__dirname,'run-tests.js'),'utf8');
  assert.match(src,/--test-reporter=\$\{COMPACT_REPORTER\}/);
  assert.match(src,/args\.includes\('--verbose'\)/);
  assert.match(src,/BUYER_LOG_TEST_VERBOSE === '1'/);
});
