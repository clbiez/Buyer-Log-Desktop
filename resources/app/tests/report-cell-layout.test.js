'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),source=read('table-report-inline.js');
function helpers(){const c={Map,Set,clean:v=>String(v??'').trim()};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function groupProjection('),source.indexOf('function cellText('))+source.slice(source.indexOf('function orderedLines('),source.indexOf('function layoutFor(')),c);return c;}
const keys=lines=>JSON.parse(JSON.stringify(lines.map(fields=>fields.map(field=>field.key))));
test('report field identity survives locale changes and source columns stay intact',()=>{
 const h=helpers(),fields=['model','plm','colour'].map(key=>({key,label:key,group:'Model Details',groupId:'model'})),before=JSON.stringify(fields),col=h.groupProjection(fields)[0],tr=h.groupProjection(fields.map(c=>({...c,group:'Model Detayları'})))[0];
 assert.equal(col.layoutId,tr.layoutId);assert.deepEqual(keys(h.orderedLines(col,{})),[['model'],['plm','colour'],[]]);
 assert.deepEqual(keys(h.orderedLines(col,{[col.layoutId]:[['plm'],['colour'],['model']]})),[['plm'],['colour'],['model']]);assert.equal(JSON.stringify(fields),before);
});
test('stale and duplicate preferences cannot duplicate cells or hide new fields',()=>{
 const h=helpers(),col={key:'group',fields:[{key:'a'},{key:'b'},{key:'new'}]};
 assert.deepEqual(keys(h.orderedLines(col,{group:[['b','b','gone'],['b'],['a']]})),[['b'],['new'],['a']]);
 assert.deepEqual(keys(h.orderedLines(col,{group:'broken'})),[['a'],['b','new'],[]]);
});
test('report copy expands groups in normal column order through the existing serializer',async()=>{
 const app=read('app-main.js'),copied=[],cols=['a','b','c'].map(k=>({k,label:k.toUpperCase()})),selected=new Set();
 const c={window:{BLGridClipboard:require('../public/grid-clipboard')},BLTableExport:require('../public/table-export'),document:{},state:{cpSelected:selected},visibleCols:()=>cols,tableColumnLabel:(_,c)=>c.label,cellPlainText:(c,r)=>r[c.k],computeFlags:()=>null,copyRichToClipboard:async(html,plain)=>{copied.push({html,plain});return true;},showToast(){},appLang:'en'};
 vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function tableReportInteraction('),app.indexOf('function syncTableReportButtons(')),c);
 await c.tableReportInteraction('cp').copy([{a:'A1',b:'B1',c:'C1'},{a:'A2',b:'B2',c:'C2'}],['c','a'],{includeHeaders:true});
 assert.equal(copied[0].plain,'A\tC\r\nA1\tC1\r\nA2\tC2');assert.doesNotMatch(copied[0].html,/rowspan|colspan/);
});
test('layout stays user scoped, supports Save/Cancel and never writes source records',()=>{
 assert.match(source,/STORE_PREFIX\+'layout\.'\+key/);assert.match(read('user-storage.js'),/'buyerlog.tableReportMode\.'/);
 for(const text of ["L('Kaydet','Save')","L('Vazgeç','Cancel')","L('Varsayılana dön','Reset layout')"])assert.ok(source.includes(text));
 assert.match(source,/BLMotionPlus\?\.play\('card'/);assert.match(source,/if\(!tabVisible\(adapter\)\)continue;/);assert.doesNotMatch(source,/row\[[^\]]+\]\s*=|rows\.(splice|sort)\(/);
});

test('unchanged report refresh preserves DOM, changed data replaces it',()=>{
 const code=source.slice(source.indexOf('function assignHtml('),source.indexOf('function labels('));
 const assign=new Function(code+';return assignHtml;')(),node={writes:0,set innerHTML(value){this.writes++;this.value=value;}};
 assert.equal(assign(node,'<tr>one</tr>'),true);assert.equal(assign(node,'<tr>one</tr>'),false);assert.equal(node.writes,1);
 assert.equal(assign(node,'<tr>two</tr>'),true);assert.equal(node.writes,2);
});
test('report row actions reuse shared menu, canonical bridges and existing BOM service',()=>{
 const app=read('app-main.js'),menu=read('row-context-menu.js');
 const bridge=app.slice(app.indexOf('function tableReportInteraction('),app.indexOf('function syncTableReportButtons('));
 assert.match(bridge,/canonical\?\.value\(source,module,'orderCode'\)/);assert.match(bridge,/allowNameMatch:false/);
 assert.match(bridge,/url:ORDER_URL\(order\)/);assert.match(bridge,/url:SHIP_URL\(order\)/);
 assert.match(menu,/window\.BLRowMenu\.openReport=function/);assert.match(menu,/plmBom\.openForRow\(row, config\.module\)/);
 assert.match(menu,/selection && !config\.report/);
});

test('new Moderator publication replaces older personal layouts, then personal saves may build on it',()=>{
 const code=source.slice(source.indexOf('function effectiveLayout('),source.indexOf('function orderedLines('));
 const effective=new Function(code+';return effectiveLayout;')(),shared={id:'publication-2',layout:{group:[['a'],['b'],[]]}};
 assert.equal(effective({group:[['b'],['a'],[]]},shared),shared.layout);
 assert.equal(effective({version:2,sharedId:'publication-1',layout:{old:true}},shared),shared.layout);
 const own={version:2,sharedId:'publication-2',layout:{group:[['b'],['a'],[]]}};assert.equal(effective(own,shared),own.layout);
 assert.equal(effective({version:2,sharedId:'publication-2'},shared),shared.layout);
 assert.deepEqual(effective({version:2,sharedId:'',layout:{}},null),{});
});
