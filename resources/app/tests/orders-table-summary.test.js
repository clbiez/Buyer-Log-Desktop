'use strict';
// Execute the actual current providers and compare with frozen pre-change behavior.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const zlib=require('node:zlib'),fixtureRoot=path.join(__dirname,'fixtures/orders-table-summary');
const baselineApp=zlib.gunzipSync(fs.readFileSync(path.join(fixtureRoot,'app-main-before.js.gz'))).toString('utf8');
const baselineChat=zlib.gunzipSync(fs.readFileSync(path.join(fixtureRoot,'lcwai-chat-before.js.gz'))).toString('utf8');
const rawApp=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const rawChat=fs.readFileSync(path.join(__dirname,'../public/lcwai-chat.js'),'utf8');
const {extractFunction}=require('./helpers/app-main-functions'),draft=require('./fixtures/orders-table-summary/patch-recipe.cjs'),candidate=true;
function object(source){const at=source.indexOf('window.BLAIScreenData = {'),end=source.indexOf('\n};',at);assert.ok(at>=0&&end>at);return source.slice(at,end+4);}
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture({module='orders',full=3,visible=2,selected=2,filtersFail=false,metadataFail=false,invalidVisible=false,selectedFail=false,lang='en',guardRows=false,legacyApi=false}={},mode=candidate){
 const records=Array.from({length:Math.max(0,full)},(_,i)=>guardRows?new Proxy({}, {get(){throw Error('record value read');},ownKeys(){throw Error('record enumerated');}}):({_id:i+1,'Order Code':i+1,__CPX_hidden:'synthetic'}));
 const filtered=records.slice(0,visible),columns=[{k:'Order Code',label:'Order Code',type:'ro'},{k:'__picture',label:'Image',type:'cpImage'},{k:'__CPX_hidden',label:'Hidden model',type:'ro',modelCustom:true},{k:'__f_x',label:'Formula',type:'formula',formulaCustom:true},{k:'_private',label:'Private',type:'ro'}];
 const selectedIds=new Set(Array.from({length:selected},(_,i)=>i+1)),calls=[],providers=[],state={orders:{rows:records},cp:{rows:records}};
 const info={tableKey:module,rowsFn:()=>{calls.push({type:'rowsFn'});if(filtersFail)throw Error('filter failed');return invalidVisible?'unsupported':filtered;},cols:()=>columns,selSet:()=>{if(selectedFail)throw Error('selection failed');return selectedIds;},filterIds:[]};
 const window={},context=vm.createContext({window,state,appLang:lang,tableInfoForTab:()=>info,visibleCols:()=>{if(metadataFail)throw Error('columns failed');return columns.slice(0,2);},
  tableColumnLabel:(_module,col)=>col.label||col.k,document:{getElementById:()=>null},console:{error(){}},AI:()=>({registerContextProvider:provider=>providers.push(provider)})});
 vm.runInContext(object(mode?rawApp:baselineApp),context);const data=window.BLAIScreenData,actualTable=data.table;
 data.table=function(tab,opts){calls.push({type:'table',tab,opts:opts?{...opts}:null});return actualTable.call(this,tab,opts);};
 if(legacyApi)delete data.tableSummary;
 const fn=extractFunction((mode?rawChat:baselineChat).replace(/^[ \t]+(?=(?:async )?function )/gm,''),'registerDefaultProviders');
 vm.runInContext(fn+'\nregisterDefaultProviders();',context);const provider=providers.find(item=>item.id===module);assert.ok(provider);
 return {data,provider,calls,records,selectedIds,options:()=>clone(provider.getOptions())};
}
const cases=[
 {name:'all visible, no selection',visible:3,selected:0},
 {name:'filtered selected',visible:1,selected:2},
 {name:'zero filtered rows',visible:0,selected:2},
 {name:'empty full rows',full:0,visible:0,selected:0},
 {name:'filter failure',filtersFail:true},
 {name:'invalid filtered result',invalidVisible:true},
 {name:'metadata failure',metadataFail:true},
 {name:'selection failure',selectedFail:true},
];
for(const lang of ['tr','en'])for(const scenario of cases)test('actual Orders getOptions '+lang+' preserves '+scenario.name+' and uses metadata-only table access',()=>{
 const options={...scenario,lang},legacy=fixture(options,false),expected=legacy.options(),observed=fixture(options,candidate),actual=observed.options();
 assert.deepEqual(actual,expected,'all/visible/selected/filters ids and TR+EN labels/details remain exact');
 const tableCalls=observed.calls.filter(call=>call.type==='table');
 assert.ok(tableCalls.every(call=>call.opts?.columnsOnly===true&&call.opts?.all===true),'no public full/filtered row capture is allowed in candidate getOptions');
 assert.ok(tableCalls.length<=1,'one actual all-column metadata call');
});
test('actual tableSummary shape exposes only counts, no row/selected-id arrays/readers',()=>{
 const f=fixture({guardRows:true}),summary=f.data.tableSummary?.('orders');assert.ok(summary,'prepared adapter must exist');
 assert.deepEqual(clone(summary),{full:{rowCount:3,columnCount:3},visible:{rowCount:2,selectedCount:2}});
 const walk=value=>{assert.equal(Array.isArray(value),false);for(const item of Object.values(value)){assert.notEqual(typeof item,'function');if(item&&typeof item==='object')walk(item);}};walk(summary);
 assert.deepEqual(f.calls.filter(call=>call.type==='table').map(call=>call.opts),[{all:true,columnsOnly:true}]);assert.equal(f.calls.filter(call=>call.type==='rowsFn').length,1);
});
test('actual metadata adapter does not inspect/clone/serialize record values when building options',()=>{
 const f=fixture({guardRows:true});assert.doesNotThrow(()=>f.options());assert.ok(f.calls.filter(call=>call.type==='table').every(call=>call.opts?.columnsOnly===true));
});
test('zero filtered rows keep visible:null; original options do not add visible/selected/filters',()=>{
 const f=fixture({visible:0,selected:2}),summary=f.data.tableSummary?.('orders');assert.equal(summary?.visible,null);assert.deepEqual(f.options().map(item=>item.id),['all']);
});
test('CP provider and metadata-absent old-app full fallback retain actual legacy behavior',()=>{
 const cpLegacy=fixture({module:'cp'},false),cpCandidate=fixture({module:'cp'},true);assert.deepEqual(cpCandidate.options(),cpLegacy.options());assert.equal(cpCandidate.calls.filter(call=>call.type==='table').length,2);
 const legacy=fixture({},false),fallback=fixture({legacyApi:true},true);assert.deepEqual(fallback.options(),legacy.options());assert.equal(fallback.calls.filter(call=>call.type==='table').length,2);
});
test('counts recipe changes no existing app function, table getter or formula/public guard behavior',()=>{
 const changed=draft.app(baselineApp),before=object(baselineApp),after=object(changed);assert.equal(after.replace(draft.summary,''),before);
 assert.equal(changed.replace(after,'__SCREEN_DATA__'),baselineApp.replace(before,'__SCREEN_DATA__'));assert.equal(extractFunction(changed,'ensureCpLoaded'),extractFunction(baselineApp,'ensureCpLoaded'));assert.equal(extractFunction(changed,'applyFormulaColumns'),extractFunction(baselineApp,'applyFormulaColumns'));
});
