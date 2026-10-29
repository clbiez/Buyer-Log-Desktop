'use strict';
// Frozen pre-Manifest anonymous workbook expectations, independent of live CSS.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function setup(theme,step){
 const context={document:{documentElement:{dataset:{theme,fontStep:String(step)}}},normalizeUiFontStep:n=>Number(n)};
 const start=source.indexOf('function shipDomExportPalette('),end=source.indexOf('function _xlsCellFromTd(',start);
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);return context;
}
test('Shipping export preserves cell colors and four row sizes independently of the UI',()=>{
 const expected={light:['#16212d','#627184'],dark:['#f0f3f6','#a0adba']};
 for(const [theme,[body,muted]] of Object.entries(expected))for(let step=0;step<4;step++){
  const c=setup(theme,step),editable=c.shipDomExportPalette({cellIndex:2,querySelector:()=>({})}),calculated=c.shipDomExportPalette({cellIndex:3,querySelector:()=>null});
  assert.equal(editable.color,body);assert.equal(calculated.color,muted);assert.equal(editable.bg,null);assert.equal(calculated.bold,false);
  assert.equal(c.shipDomExportRowHeight(),[24,27,30,21][step]);
 }
});
test('Only generic Shipping uses the frozen DOM export adapter',()=>{
 assert.match(source,/table\.id==='shipTable'\?shipDomExportPalette\(td\):null/);
 assert.match(source,/table\.id==='shipTable'\?shipDomExportRowHeight\(\)/);
 const render=source.slice(source.indexOf('function renderShipTable('),source.indexOf('function commitShipEditor('));
 assert.doesNotMatch(render,/font-size:[\d.]+px|SHIP_HEADER_COLORS/);
 assert.match(source,/const SHIP_HEADER_COLORS =/,'dedicated template workbook keeps its original palette');
});
