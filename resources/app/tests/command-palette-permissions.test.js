'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/command-palette.js'),'utf8');
test('palette modules and recent destinations use current access and recheck before native navigation',()=>{
 const allowed=new Set(['cp','opencosting']),clicks=[],values=new Map([['buyerlog.workspace.commandPalette.recent.v1',JSON.stringify(['orders','cp','unknown','cp'])]]),doc={documentElement:{lang:'en'},body:{dataset:{activeTab:'cp'}},addEventListener(){},getElementById(){return null;}};
 const buttons=['cp','orders','source','opencosting'].map(tab=>({dataset:{tab},style:{},hidden:false,disabled:false,getAttribute:()=>null,querySelector:()=>({textContent:tab}),click:()=>{clicks.push(tab);doc.body.dataset.activeTab=tab;}}));
 doc.querySelectorAll=()=>buttons;doc.querySelector=selector=>buttons.find(button=>selector.includes('data-tab="'+button.dataset.tab+'"'))||null;
 const sb={window:null,document:doc,BLCanAccessArea:area=>allowed.has(area),BLStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},addEventListener(){},setTimeout(){}};sb.window=sb;vm.runInNewContext(source,sb);
 const commands=sb.BLCommandPalette.commands();assert.equal(commands.some(x=>x.tab==='orders'||x.tab==='source'),false);assert.deepEqual(Array.from(commands.filter(x=>x.group==='Recent destinations'),x=>x.tab),['cp']);
 const cp=commands.find(x=>x.id==='tab.cp');allowed.delete('cp');assert.equal(cp.run(),false);assert.equal(clicks.length,0);const costing=sb.BLCommandPalette.commands().find(x=>x.id==='tab.opencosting');assert.equal(costing.run(),true);assert.deepEqual(clicks,['opencosting']);assert.deepEqual(JSON.parse(values.get('buyerlog.workspace.commandPalette.recent.v1')),['opencosting','orders','cp','unknown']);
});
