'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const BLRevision = require(path.join(ROOT, 'public', 'revision-display.js'));

const EMPTY_OVERRIDES = {
  notesmap:{}, submap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, licensormap:{},
  pricingRules:[], transitRules:[], imagemap:{}, datemap:{}
};
function order(extra={}){
  return {
    ocode:1234567, model:'MODEL A', ccode:'001', colour:'BLACK', season:'W6', countryRaw:'MISIR',
    manufacturer:'MFR', license:'DTR', category:'TOP', qty:100, kalan:100, fob:5,
    opd:new Date(2026,0,1), ex:new Date(2026,4,12), retail:new Date(2026,6,1),
    mb:new Date(2026,6,15), merkezSevkeHazirKalan:0, ...extra
  };
}

test('v6.04 CP payload carries LT so an untouched LT cannot appear as 131→—', () => {
  const row=parse.buildCPRowsFromASAS([order()],{},EMPTY_OVERRIDES)[0];
  assert.equal(row.LT,131);
  assert.equal(row['Ex→Retail'],50);
});

test('v6.04 revision comparison can use the live derived value instead of stale raw row value', () => {
  const row={
    'Ex-factory':new Date(2026,0,5), _asasExFactory:new Date(2026,0,1),
    'Retail Date':new Date(2026,2,1), _asasRetailDate:new Date(2026,2,1),
    'In-Store (Model Budget)':new Date(2026,2,15), _asasInStore:new Date(2026,2,15),
    'Ex→Retail':55, LT:'', Priority:'In Time'
  };
  const base=BLRevision.baselineRow(row, r=>{ r['Ex→Retail']=59; r.LT=131; r.Priority='In Time'; });
  assert.deepEqual(BLRevision.info(row,'Ex→Retail',base),{from:59,to:55},'raw row can still be stale');
  assert.equal(BLRevision.infoValue(row,'Ex→Retail',base,59),null,'live derived rollback must clear the arrow immediately');
  assert.equal(BLRevision.infoValue(row,'LT',base,131),null,'live LT must not show 131→—');
});

test('v6.04 CP cell renderer feeds computeFlags results into revision comparison', () => {
  const app=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
  assert.match(app,/const rev = revisionInfo\(r, c\.k, cf\);/);
  assert.match(app,/if\(key==='Ex→Retail'\).*BLRevision\.infoValue\(row,key,base,computed\.exr==null\?'':computed\.exr\)/s);
  assert.match(app,/if\(key==='LT'\).*BLRevision\.infoValue\(row,key,base,computed\.lt==null\?'':computed\.lt\)/s);
});
