'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../public/lcwai-output-layout');
const items=Array.from({length:24},(_,i)=>({image:`KOL-${i+1}`,title:`Model ${i+1}`,fields:[]}));
const slides=[{layout:'gallery',title:'T-Shirt',items}];
const records=Object.fromEntries(items.map((item,i)=>[item.image,{values:{fabric:i<12?'Jersey':'Scuba',fit:'Regular Fit',description:'Full description '.repeat(12)},labels:{fit:'Fit',description:'Description'}}]));
const layout={columns:3,rows:3,cardFields:['fit','description'],showFieldLabels:true,studio:{matrix:true,sizing:'equal',reflow:'balanced',subtitleFields:['fabric']}};
test('matrix: fixed typography and complete wrapped details survive paging',()=>{
 const pages=L.expandGalleries(slides,layout,{records});
 assert.equal(pages.flatMap(e=>e.page.cells).length,24);
 const sizes=[];
 for(const e of pages)for(const c of e.page.cells){const x=L.cardContent(c,L.normalizeLayout('pptx',layout),c.item,records[c.item.image],e.page.scale);assert.equal(x.hidden,0);assert.equal(x.lines.flat().filter(r=>r.label==='Description').map(r=>r.value).join(''),records[c.item.image].values.description.trim());sizes.push(x.box.size);assert.ok(x.box.imgH>=0)}
 assert.equal(new Set(sizes).size,1);
 assert.ok(pages[0].page.subtitle.includes('Jersey'));
});
test('matrix: manual page/group order conserves records and source values',()=>{
 const before=JSON.stringify(records);
 const manualPages=[[{title:'Second group',tokens:['KOL-9','KOL-1']}],[{title:'First group',tokens:['KOL-2']}]];
 const pages=L.expandGalleries(slides,{...layout,studio:{...layout.studio,manualPages}},{records});
 const tokens=pages.flatMap(e=>e.page.cells.map(c=>c.item.image));assert.deepEqual(tokens.slice(0,3),['KOL-9','KOL-1','KOL-2']);assert.equal(tokens.length,24);assert.equal(new Set(tokens).size,24);assert.equal(JSON.stringify(records),before);
});
test('matrix: normalized settings reject invalid tokens and clamp sizes',()=>{
 const s=L.normalizeStudio({matrix:true,subtitleSize:999,groupSize:0,manualPages:[[{title:'x',tokens:['KOL-1','../x','KOL-2']}]]});assert.equal(s.subtitleSize,28);assert.deepEqual(s.manualPages[0][0].tokens,['KOL-1','KOL-2']);
});
test('matrix: extreme metadata continues across cards instead of clipping text',()=>{
 const longRecords={'KOL-1':{values:Object.fromEntries(Array.from({length:24},(_,i)=>['field'+i,'x'.repeat(300)]))}};
 const raw={...layout,cardFields:Object.keys(longRecords['KOL-1'].values),columns:8,cardTextSize:18};
 const pages=L.expandGalleries([{layout:'gallery',title:'Long details',items:[items[0]]}],raw,{records:longRecords});
 assert.ok(pages.length>1);
 const data=pages.flatMap(e=>e.page.cells.flatMap(c=>L.cardContent(c,L.normalizeLayout('pptx',raw),c.item,longRecords[c.item.image]).lines.flat()));
 assert.equal(data.reduce((n,row)=>n+row.value.length,0),24*300);
 for(const e of pages)for(const c of e.page.cells){const x=L.cardContent(c,L.normalizeLayout('pptx',raw),c.item,longRecords[c.item.image]);assert.ok(x.requiredHeight<=c.h+1,`${x.requiredHeight} > ${c.h}`)}
});
test('matrix: templates omit record-specific placements and group values',()=>{
 const T=require('../server/lib/lcwai-output/output-user-templates');
 const def=T.normalizeDefinition({format:'pptx',layout:{...layout,studio:{...layout.studio,manualPages:[[{title:'Private model group',tokens:['KOL-1']}]],spans:{'KOL-1':2}}}});
 assert.deepEqual(def.layout.studio.manualPages,[]);assert.deepEqual(def.layout.studio.spans,{});assert.ok(!JSON.stringify(def).includes('Private model group'));
});
test('matrix: moving gallery groups keeps the cover before the gallery',()=>{
 const deck=[{layout:'title',title:'Cover'},...slides];
 const pages=L.expandGalleries(deck,{...layout,studio:{...layout.studio,manualPages:[[{title:'A',tokens:['KOL-1']}]]}},{records});
 assert.equal(pages[0].slide.title,'Cover');assert.deepEqual(pages[0].sources,[0]);
});
