'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

const mapping={
  overview:'BL-N01',
  cp:'BL-N03',
  orders:'BL-N06',
  backlog:'BL-N08',
  shipping:'BL-N09',
  koleksiyon:'BL-N11',
  quotations:'BL-N13',
  pricinghistory:'BL-N15',
  priceanalysis:'BL-N17',
  lfl:'BL-N19',
  opencosting:'BL-N21',
  automations:'BL-N23',
  source:'BL-N25',
};

test('sidebar uses Buyer Log Minimal Icon Library v3 recommended module mapping',()=>{
  for(const [tab,code] of Object.entries(mapping)){
    const id='i-bl-'+code.toLowerCase().replace('bl-','');
    const button=new RegExp('<button[^>]*data-tab="'+tab+'"[^>]*>[\\s\\S]*?<use href="#'+id+'"/>[\\s\\S]*?</button>');
    assert.match(INDEX,button,tab+' should use '+code);
    assert.match(INDEX,new RegExp('<symbol id="'+id+'" data-bl-code="'+code+'"'));
  }
});

test('Minimal v3 sidebar icons are single-tone outline icons with the 1.45 stroke grammar',()=>{
  for(const code of Object.values(mapping)){
    const id='i-bl-'+code.toLowerCase().replace('bl-','');
    const start=INDEX.indexOf('<symbol id="'+id+'"');
    const end=INDEX.indexOf('</symbol>',start);
    assert.ok(start>=0&&end>start,'missing '+code);
    const source=INDEX.slice(start,end);
    assert.match(source,/fill="none"/);
    assert.match(source,/stroke="currentColor"/);
    assert.match(source,/stroke-width="1\.45"/);
    assert.doesNotMatch(source,/fill-opacity|--ic-tint|gradient/i);
  }
});
