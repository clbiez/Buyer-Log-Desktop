'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,`${start} missing`);assert.ok(b>a,`${end} missing`);return source.slice(a,b);}
test('v5.63 Collection Best Price footer shows weighted and arithmetic averages',()=>{
  const block=between(APP,'function renderKolSummaryFooter(', '// Aynı satırdaki geçerli');
  assert.match(block,/bestGetter=row=>\{const best=kolBestPricing\(row\);return best\?best\.price:'';\}/);
  assert.match(block,/bestAvg=kolWeightedAverage\(rows,bestGetter\),bestArithmetic=kolArithmeticAverage\(rows,bestGetter\)/);
  assert.match(block,/d\.kind==='best'[\s\S]*?kolAverageFooter\(bestAvg,bestArithmetic,L\('Best Price'\)\)/);
  assert.match(block,/metricDescriptor=d=>d\.kind==='best'\|\|d\.kind==='confirmedPrice'/);
});
