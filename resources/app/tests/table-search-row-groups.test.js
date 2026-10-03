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
