'use strict';
// Server event-loop stall profiles were dominated by repeated tr-TR upper-casing
// of the same short values (order-importance fold ~12%, user-access norm and
// business-rules turkNorm ~5%). The memoized forms must stay byte-identical.
const test=require('node:test'),assert=require('node:assert/strict');
const Importance=require('../public/order-importance.js');
const Rules=require('../public/business-rules.js');
const Access=require('../server/lib/user-access.js');

const MAP={'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'};
const reference={
  fold:value=>String(value==null?'':value).replace(/\s+/g,' ').trim().toLocaleUpperCase('tr-TR')
    .replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C'),
  turkNorm:value=>String(value==null?'':value).toUpperCase().replace(/[İŞÇÖÜĞ]/g,c=>MAP[c]).replace(/\s+/g,' ').trim(),
  norm:value=>String(value==null?'':value).trim().toLocaleUpperCase('tr-TR'),
};
const inputs=[null,undefined,'',' ',0,12.5,true,'istanbul','İSTANBUL','ıııiii','  çok   boşluklu\tmetin\n','Şişli Ğ Ü Ö Ç','Back To School','bts',
  'x'.repeat(161)+'ç','x'.repeat(160),'ΣΊΣΥΦΟΣ','ǅemal','ß',{toString:()=>'nesne ı'},['a','b']];

for(const [name,actual] of [['fold',Importance.fold],['turkNorm',Rules.turkNorm],['norm',Access.norm]]){
  test(`${name} memo returns exactly the uncached result, also on repeated calls`,()=>{
    for(let round=0;round<3;round++)for(const value of inputs)assert.equal(actual(value),reference[name](value),`${name}(${String(value)})`);
  });
  test(`${name} memo stays bounded and correct after its cache is cleared`,()=>{
    for(let i=0;i<50010;i++)actual('değer '+i);
    for(const value of inputs)assert.equal(actual(value),reference[name](value));
    assert.equal(actual('değer 50009'),reference[name]('değer 50009'));
  });
}

test('importance resolution is unchanged for line/season rules and manual tags', () => {
  const settings=Importance.normalizeSettings({tags:[{id:'bts',label:'Back To School'},{id:'bayram',label:'Bayram'}],
    rules:[{tagId:'bts',lines:['Kids Boy Knit','kıds gırl knıt'],seasons:['2026 Yaz']},{tagId:'bayram',lines:['Men Licence']}]});
  assert.equal(Importance.resolve({line:'KIDS BOY KNIT',season:'2026 yaz'},undefined,settings).id,'bts');
  assert.equal(Importance.resolve({line:'Kids Girl Knit',season:'2026 YAZ'},undefined,settings).id,'bts');
  assert.equal(Importance.resolve({line:'Kids Boy Knit',season:'2025 Kış'},undefined,settings).id,'regular');
  assert.equal(Importance.resolve({line:'men licence'},undefined,settings).id,'bayram');
  assert.equal(Importance.resolve({line:'men licence'},'regular',settings).source,'manual');
});
