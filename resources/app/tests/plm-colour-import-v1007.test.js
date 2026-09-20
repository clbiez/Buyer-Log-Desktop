'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const colourUtils=require('../public/plm-colour-utils.js');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('PLM fill colours become one import variant per colour cell',()=>{
  const variants=colourUtils.extractColourVariants({
    cells:[
      {s:{fgColor:{rgb:'111F2B'}}},
      {s:{fgColor:{rgb:'FF18454B'}}},
      {s:{fgColor:{rgb:'FFFFFF'}}},
    ],
  });
  assert.deepEqual(variants,[
    {colourCode:'#111F2B',colour:'#111F2B'},
    {colourCode:'#18454B',colour:'#18454B'},
  ]);
});

test('PLM rows without a usable swatch stay as one row and preserve text values',()=>{
  assert.deepEqual(colourUtils.extractColourVariants({cells:[],colourCode:'12',colour:'Navy'}),[
    {colourCode:'12',colour:'Navy'},
  ]);
  assert.deepEqual(colourUtils.extractColourVariants({cells:[{s:{fgColor:{rgb:'FFFFFF'}}}]}),[
    {colourCode:'',colour:''},
  ]);
});

test('PLM colour normalization accepts alternate style shapes and rejects invalid fills',()=>{
  assert.equal(colourUtils.colourFromCell({s:{fill:{fgColor:{argb:'FFABCDEF'}}}}),'#ABCDEF');
  assert.equal(colourUtils.colourFromCell({s:{fgColor:{rgb:'not-a-colour'}}}),'');
  assert.equal(colourUtils.colourFromCell(null),'');
  assert.deepEqual(colourUtils.extractColourVariants({cells:null}),[{colourCode:'',colour:''}]);
});

test('PLM importer reads styles and loads the colour utility before app-main',()=>{
  assert.match(APP,/cellStyles:true/);
  assert.match(APP,/extractColourVariants/);
  assert.match(APP,/kolPlmImportColourKey/);
  assert.match(INDEX,/plm-colour-utils\.js[^\n]*<\/script>[\s\S]*app-main\.js/);
});

test('PLM import duplicate identity includes colour so legitimate colour variants survive',()=>{
  const block=APP.slice(APP.indexOf('function kolBuildPlmImportPlan'),APP.indexOf('function kolPlmMappingRows'));
  assert.match(block,/seenInputPlm/);
  assert.match(block,/kolPlmImportColourKey\(parsed\)/);
  assert.match(block,/colourMatches/);
});
