'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const rowGroups=require('../public/table-search-row-groups.js');
const {createTableSearch}=require('./helpers/bl-table-search');

function installedSearch(){
  const table=createTableSearch();
  const host={
    BLTableSearch:table,
    parseTableSearchTerms:table.parseTerms,
    tableSearchMatches:table.matches,
  };
  assert.equal(rowGroups.install(host),true);
  return {host,table:host.BLTableSearch};
}

test('çok sütunlu Excel panosu satır ilişkisini parantezli gruplarla korur',()=>{
  assert.equal(
    rowGroups.formatClipboardMatrix('A\t1\r\nB\t2\r\nC\t3\r\nD\t4\r\nE\t5'),
    '(A; 1), (B; 2), (C; 3), (D; 4), (E; 5)'
  );
  assert.equal(
    rowGroups.formatClipboardMatrix('MODEL-A\tRED\t1001\nMODEL-B\tBLUE\t1002'),
    '(MODEL-A; RED; 1001), (MODEL-B; BLUE; 1002)'
  );
});

test('tek sütunlu Excel listesi mevcut VEYA davranışını korur',()=>{
  assert.equal(rowGroups.formatClipboardMatrix('A\nB\nA\nC'), 'A, B, C');
});

test('parantez grupları kendi içinde VE, birbirleri arasında VEYA çalışır',()=>{
  const {table}=installedSearch();
  const terms=table.parseTerms('(A; 1), (B; 2)');

  assert.equal(rowGroups.isRowGroupTerms(terms),true);
  assert.equal(table.matches('MODEL A ORDER 1',terms,{plainMode:'contains'}),true);
  assert.equal(table.matches('MODEL B ORDER 2',terms,{plainMode:'contains'}),true);
  assert.equal(table.matches('MODEL A ORDER 2',terms,{plainMode:'contains'}),false);
  assert.equal(table.matches('MODEL B ORDER 1',terms,{plainMode:'contains'}),false);
});

test('üç sütunlu grup ancak aynı Buyer Log satırında üç koşul da varsa eşleşir',()=>{
  const {table}=installedSearch();
  const terms=table.parseTerms('(MODEL-A; RED; 1001), (MODEL-B; BLUE; 1002)');

  assert.equal(table.matches('MODEL-A RED 1001',terms,{plainMode:'contains'}),true);
  assert.equal(table.matches('MODEL-A RED 1002',terms,{plainMode:'contains'}),false);
  assert.equal(table.matches('MODEL-B BLUE 1002',terms,{plainMode:'contains'}),true);
});

test('parantezsiz mevcut arama sözdizimi eski parser ve matcher üzerinden aynen devam eder',()=>{
  const legacy=createTableSearch();
  const legacyParsed=legacy.parseTerms('ABC; Z, /XY');

  const {table}=installedSearch();
  const extendedParsed=table.parseTerms('ABC; Z, /XY');

  assert.deepEqual(extendedParsed,legacyParsed);
  assert.equal(
    table.matches('ABC XY',extendedParsed,{plainMode:'contains'}),
    legacy.matches('ABC XY',legacyParsed,{plainMode:'contains'})
  );
});

test('grup içindeki kaçışlar hücre değerindeki noktalı virgül ve parantezi bozmaz',()=>{
  const query=rowGroups.formatClipboardMatrix('A;X\t1\nB(2)\t3');
  assert.equal(query,'(A\\;X; 1), (B\\(2\\); 3)');

  const {table}=installedSearch();
  const terms=table.parseTerms(query);
  assert.equal(table.matches('A;X 1',terms,{plainMode:'contains'}),true);
  assert.equal(table.matches('B(2) 3',terms,{plainMode:'contains'}),true);
  assert.equal(table.matches('A;X 3',terms,{plainMode:'contains'}),false);
});

test('arama kutusuna matrix paste capture aşamasında satır-grup sorgusuna çevrilir',()=>{
  let pasteListener=null;
  const doc={
    addEventListener(type,listener,capture){
      if(type==='paste'){
        pasteListener=listener;
        assert.equal(capture,true);
      }
    }
  };
  class FakeEvent{constructor(type,opts){this.type=type;this.bubbles=!!opts?.bubbles;}}
  let dispatched=null;
  const host={Event:FakeEvent};
  assert.equal(rowGroups.bindPaste(doc,host),true);
  assert.equal(typeof pasteListener,'function');

  const target={
    id:'cpSearch',
    value:'old',
    setSelectionRange(){},
    dispatchEvent(event){dispatched=event;}
  };
  let prevented=false,stopped=false;
  pasteListener({
    target,
    clipboardData:{getData:()=> 'A\t1\nB\t2'},
    preventDefault(){prevented=true;},
    stopImmediatePropagation(){stopped=true;},
  });

  assert.equal(target.value,'(A; 1), (B; 2)');
  assert.equal(prevented,true);
  assert.equal(stopped,true);
  assert.equal(dispatched?.type,'input');
  assert.equal(dispatched?.bubbles,true);
});

test('row-group script app-main sonrasında ve arama yardımından önce yüklenir',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const app=html.indexOf('app-main.js?v=');
  const groups=html.indexOf('table-search-row-groups.js?v=');
  const help=html.indexOf('table-search-help.js?v=');
  assert.ok(app>=0&&groups>app&&help>groups);
});

test('parantez grubunda sonek ! önek ! ile aynı hariç tutmadır',()=>{
  const {table}=installedSearch();
  const suffix=table.parseTerms('(SHIRT; RED!)');
  const prefix=table.parseTerms('(SHIRT; !RED)');
  assert.deepEqual(suffix,prefix);
  assert.equal(table.matches('SHIRT BLUE',suffix,{plainMode:'contains'}),true);
  assert.equal(table.matches('SHIRT RED',suffix,{plainMode:'contains'}),false);
  assert.deepEqual(rowGroups.criterionFromCell('ABC!DEF'),{mode:'exact',value:'abc!def'});
});


test('arama sırası ilk eşleşmeye göre, kararlı ve kaynak satırlara dokunmadan uygulanır',()=>{
  const {table}=installedSearch();
  const rows=[{text:'A',n:1},{text:'C',n:2},{text:'B',n:3},{text:'B C',n:4},{text:'B',n:5}];
  const ordered=table.orderRows(rows,table.parseTerms('B, C, A'),row=>row.text,{plainMode:'contains'});
  assert.deepEqual(ordered.map(row=>row.n),[3,4,5,2,1]);
  assert.deepEqual(rows.map(row=>row.n),[1,2,3,4,5]);
  assert.equal(table.orderRows(rows,table.parseTerms(''),row=>row.text),rows);
  assert.equal(table.orderRows(rows,table.parseTerms('!Z'),row=>row.text),rows);
});

test('Excel satır grupları, tek sütun ve VE içindeki VEYA sırası korunur',()=>{
  const {table}=installedSearch();
  const rows=['MODEL-A RED','MODEL-B BLUE','MODEL-C GREEN'];
  const order=query=>table.orderRows(rows,table.parseTerms(query),row=>row,{plainMode:'contains'});
  assert.deepEqual(order(rowGroups.formatClipboardMatrix('MODEL-C\tGREEN\nMODEL-A\tRED\nMODEL-B\tBLUE')), [rows[2],rows[0],rows[1]]);
  assert.deepEqual(order(rowGroups.formatClipboardMatrix('MODEL-B\nMODEL-C\nMODEL-A')), [rows[1],rows[2],rows[0]]);
  assert.deepEqual(order('MODEL; GREEN, BLUE, RED; !Z'),[rows[2],rows[1],rows[0]]);
});

test('grup sıralaması her koşulu aynı fiziksel satırda arar',()=>{
  const {table}=installedSearch();
  const rows=[['A 2','B 1'],['B 2'],['A 1']];
  assert.deepEqual(table.orderRows(rows,table.parseTerms('(B; 2), (A; 1)'),row=>row),[rows[1],rows[2],rows[0]]);
});

test('Collection arama sırası aktif sütun sırasını ve geçici sabitlemeyi aşar; model ailesi birlikte kalır',()=>{
  const {table}=installedSearch();
  const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const code=source.slice(source.indexOf('function kolGroupMembersIndex('),source.indexOf('function filteredKol('));
  const rows=[{id:1,text:'A',modelGroupId:'g',modelGroupRole:'parent'}, {id:2,text:'A',modelGroupId:'g'}, {id:3,text:'B'}];
  const order=new Function('window','kolRows','kolSort','kolTransientTopRowId','kolIsColorSpecific','kolCompareRowsForActiveSort','kolSearchHaystack',code+';return kolGroupAwareOrder;')({BLTableSearch:table},rows,{key:'text'},1,()=>false,(a,b)=>a.text.localeCompare(b.text),row=>row.text);
  assert.deepEqual(order(rows,table.parseTerms('B, A')).map(row=>row.id),[3,1,2]);
  assert.deepEqual(order(rows,table.parseTerms('')).map(row=>row.id),[1,2,3]);
});
