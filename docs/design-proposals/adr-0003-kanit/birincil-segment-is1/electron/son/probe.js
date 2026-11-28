const path=require('path'),[APP,SRC]=process.argv.slice(2);
const CRE=require(path.join(APP,'public/cp-readiness-engine.js'));const orig=CRE.analyzeOrder;let n=0,tot=0n;
const parse=require(path.join(APP,'server/lib/parse.js'));
const XLSX=require(path.join(APP,'node_modules/xlsx'));const cfg=parse.defaultAntrepoMatchConfig();
const asas=parse.parseASASWorkbook(XLSX.readFile(path.join(SRC,'ASAS - Demo.xlsx'),{cellDates:true}),cfg);const ant=parse.parseAntrepoWorkbook(XLSX.readFile(path.join(SRC,'Antrepo - Demo.xlsx'),{cellDates:true}),cfg);
const ov={antrepoMatchConfig:cfg,submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},pricingRules:[],transitRules:process.env.TR?JSON.parse(process.env.TR):[],datemap:{}};
for(let i=0;i<4;i++){if(global.gc)global.gc();const t=process.hrtime.bigint();parse.buildSharedOrderProjectionRowsFromASAS(parse.applyDateOverrides(asas.orders||asas,ov),ant.map||ant,ov);console.log(APP.includes('wt-main')?'main':'aday','build ms',(Number(process.hrtime.bigint()-t)/1e6).toFixed(0));}
