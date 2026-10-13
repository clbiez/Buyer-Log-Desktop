'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');
function between(start,end){
  const i=APP.indexOf(start),j=APP.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,'Missing email editor section: '+start);
  return APP.slice(i,j);
}
function isolate(name,start,end,deps={}){
  return new Function(...Object.keys(deps),between(start,end)+'\nreturn '+name+';')(...Object.values(deps));
}

test('email table defaults to the active CP display order; saved order wins',()=>{
  const defs=['__picture','Order Code','PLM ID','Model Name','Season'].map(k=>({k}));
  let stored=null;
  const read=isolate('mailTopicColumnKeys','function mailTopicColumnKeys','function mailTopicSetColumnKeys',{
    mailTopicFindItem:()=>stored,
    mailTopicSourceColumns:()=>defs,
    mailTopicDefaultColumnKeys:()=>['Order Code','PLM ID','Model Name','Season'],
    visibleCols:()=>['Season','Model Name','Order Code','PLM ID','__picture'].map(k=>({k})),
    kolAllOrderedCols:()=>[]
  });
  assert.deepEqual(read('general','shipment','cp'),['Season','Model Name','Order Code','PLM ID']);
  stored={tableColumns:{cp:['PLM ID','Order Code']}};
  assert.deepEqual(read('general','shipment','cp'),['PLM ID','Order Code']);
  stored={tableColumns:{cp:[]}};
  assert.deepEqual(read('general','shipment','cp'),[]);
});

test('email table and Excel use the selected custom order, not schema order',()=>{
  const select=isolate('mailTopicSelectedColumns','function mailTopicSelectedColumns','function mailTopicDefaultContentOptions',{
    mailTopicSourceColumns:()=>[{k:'A'},{k:'B'},{k:'C'}],
    mailTopicColumnKeys:()=>['C','A']
  });
  assert.deepEqual(select('general','shipment','cp').map(c=>c.k),['C','A']);
});

test('subject supports custom field positions and separator while keeping defaults',()=>{
  const order=isolate('mailTopicSubjectOrder','function mailTopicSubjectOrder','function mailTopicSubjectSeparator',{
    mailTopicFindItem:()=>({subjectOrder:{cp:['__date','__title','Season','__manufacturer']}}),
    mailTopicSubjectColumnKeys:()=>['Season'],
    mailTopicSubjectIncludesManufacturer:()=>true,
    mailTopicSourceColumns:()=>[{k:'Season'}],
    prepareEmailSubjectColumnPriority:()=>2
  });
  assert.deepEqual(order('general','shipment','cp'),['__date','__title','Season','__manufacturer']);
  const subject=isolate('prepareEmailBuildSubject','function prepareEmailBuildSubject','function prepareEmailTopicTablePlain',{
    prepareEmailSubjectSegment:v=>String(v??'').trim(),
    prepareEmailSubjectColumnValue:(rows,col)=>String(rows[0][col.k]||''),
    mailTopicSelectedSubjectColumns:()=>[{k:'Season'}],
    mailTopicSubjectOrder:order,
    mailTopicSubjectSeparator:()=>' - ',
    mailTopicSubjectIncludesManufacturer:()=>true,
    mailTopicSubjectTitle:()=>'Shipment Check'
  });
  assert.equal(subject({kind:'general',id:'shipment',subjectTitle:'Shipment Check'},
    [{Season:'S7'}],'Maker','cp','13.10.2026',
    {columns:[{k:'Season'}],manufacturer:true,subjectTitle:'Shipment Check',
     order:['__date','__title','Season','__manufacturer'],separator:' | '}),
    '13.10.2026 | Shipment Check | S7 | Maker');
});

test('CP pictures resolve through the same canonical identity used in the CP grid',()=>{
  const source=isolate('prepareEmailImageSource','function prepareEmailImageSource','function prepareEmailImageDims',{
    tableRowImageSource:()=>({source:'/canonical/image.png'})
  });
  assert.equal(source({_imageRef:'old',_imageUrl:'/stale'},'cp'),'/canonical/image.png');
  const asset=between('async function prepareEmailInlineAsset','async function prepareEmailTopicTableContent');
  assert.match(asset,/cpOrdersRowImageDataUrl\(row\)/);
  assert.match(asset,/toDataURL\('image\/jpeg',0\.8\)/);
  const table=between('async function prepareEmailTopicTableContent','function prepareEmailTopicCell');
  assert.match(table,/if\(failures\.length\)throw new Error/);
  assert.match(table,/seen\.has\(asset\.cid\)/);
});

test('editor includes practical field search, ordering and theme-compatible controls',()=>{
  const editor=between('function openMailTopicEditor','function mailTplToHtml');
  assert.match(editor,/mailTopicFieldSearch/);
  assert.match(editor,/mailTopicColsCpOrder|resetOrder/);
  assert.match(editor,/data-mail-column-move/);
  assert.match(editor,/data-subject-move/);
  assert.match(editor,/mailTopicSeparatorCustom/);
  assert.match(editor,/topic\.subjectOrder\[sourceKind\]=subjectArrange\.slice\(\)/);
  assert.match(CSS,/\.mailTopicSubjectArrange\{/);
  assert.match(CSS,/background:var\(--card2\)/);
});
