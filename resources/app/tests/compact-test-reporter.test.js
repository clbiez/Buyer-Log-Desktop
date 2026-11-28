'use strict';
// npm test varsayılan kompakt çıktı sözleşmesi: geçen testler ve console gürültüsü
// yazılmaz; başarısız test dosya:satır + hata ile, başarısız dosyanın çıktısı ve özet yazılır.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

const REPORTER=path.join(__dirname,'compact-reporter.js');

test('compact reporter prints only failures, failing-file output and a summary',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compact-'));
  try{
    fs.writeFileSync(path.join(dir,'pass.test.js'),"require('node:test')('quiet pass',()=>{console.log('PASS_NOISE');});\n");
    fs.writeFileSync(path.join(dir,'fail.test.js'),"const t=require('node:test');t.describe('grp',()=>{t('broken case',()=>{console.error('FAIL_CONTEXT');require('node:assert').equal(1,2);});t('fine',()=>{});});\n");
    fs.writeFileSync(path.join(dir,'crash.test.js'),"throw new Error('LOAD_CRASH');\n");
    const r=spawnSync(process.execPath,['--test','--test-reporter='+pathToFileURL(REPORTER).href,'pass.test.js','fail.test.js','crash.test.js'],{cwd:dir,encoding:'utf8',env:(({NODE_TEST_CONTEXT,...rest})=>rest)(process.env)});
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
  // Windows'ta "D:\\…\\compact-reporter.js" düz yolu ESM yükleyicisinde "d:" şeması
  // sanılır (ERR_UNSUPPORTED_ESM_URL_SCHEME) ve TEST tam regresyonu hiç başlamaz.
  assert.match(src,/COMPACT_REPORTER = pathToFileURL\(path\.join\(TEST_ROOT, 'compact-reporter\.js'\)\)\.href/);
  assert.match(src,/args\.includes\('--verbose'\)/);
  assert.match(src,/BUYER_LOG_TEST_VERBOSE === '1'/);
});

test('compact reporter records per-file wall time and reports todo gaps without a failure mark',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compact-time-'));
  try{
    fs.writeFileSync(path.join(dir,'slow.test.js'),"require('node:test')('slow',async()=>{await new Promise(r=>setTimeout(r,250));});\n");
    fs.writeFileSync(path.join(dir,'gap.test.js'),"require('node:test')('known gap',{todo:'bilinen açık'},()=>{throw new Error('GAP_DETAIL');});\n");
    // İç süreç sızıntısı: test dosyasının başlattığı süreç süre dosyası adresini görmemeli.
    fs.writeFileSync(path.join(dir,'inner.test.js'),"require('node:test')('inner',()=>{if(process.env.BUYER_LOG_TEST_TIMINGS_FILE)throw new Error('LEAK');});\n");
    const timings=path.join(dir,'timings.jsonl');
    const env=(({NODE_TEST_CONTEXT,...rest})=>rest)(process.env);
    const r=spawnSync(process.execPath,['--test','--test-reporter='+pathToFileURL(REPORTER).href,'slow.test.js','gap.test.js','inner.test.js'],{cwd:dir,encoding:'utf8',env:{...env,BUYER_LOG_TEST_TIMINGS_FILE:timings}});
    const out=r.stdout+r.stderr;
    assert.equal(r.status,0,out);
    assert.match(out,/◌ todo \(bilinen açık, başarısız sayılmaz\): known gap \(gap\.test\.js:1\) — GAP_DETAIL/);
    assert.doesNotMatch(out,/✖/);
    assert.match(out,/fail 0 · cancelled 0 · skipped 0 · todo 1/);
    const rows=fs.readFileSync(timings,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(rows.map(row=>row.file).sort(),['gap.test.js','inner.test.js','slow.test.js']);
    const slow=rows.find(row=>row.file==='slow.test.js');
    assert.ok(slow.ms>=250,'file wall time includes the test body: '+slow.ms);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('npm test prints the slowest files, the batch critical path and the runner environment',()=>{
  const src=fs.readFileSync(path.join(__dirname,'run-tests.js'),'utf8');
  assert.match(src,/BUYER_LOG_TEST_TIMINGS_FILE: timingsFile/);
  assert.match(src,/En yavaş \$\{slowest\.length\} dosya/);
  assert.match(src,/En uzun dosya \$\{seconds\(longest\.ms\)\}/);
  assert.match(src,/\[Buyer Log tests\] Ortam: Node \$\{process\.version\}/);
  assert.match(src,/BUYER_LOG_TEST_SLOWEST/);
});
