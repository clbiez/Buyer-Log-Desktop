'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const swatch='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#e9edf1"/><path d="M80 120h320M80 180h320M80 240h320M80 300h320M80 360h320M80 420h320" stroke="#5f6f80"/><text x="80" y="520" fill="#16212d" font-size="24">DEMO / KNIT SWATCH</text></svg>');
const cases=[
 ['model-column','_cpModelColumnModal','void openCpModelColumnModal()','cp'],
 ['image-preview','kolImgPopupImg',`kolShowImgPopup(${JSON.stringify(swatch)},{clientX:700,clientY:300})`,'koleksiyon'],
 ['plm-scope','_plmSyncActionModal',"void plmSyncActionModal({title:'PLM SYNC',actions:plmSyncScopeActions({selectedIdentities:[]},{collection:true})})",'koleksiyon'],
 ['backlog-chart-settings','_backlogChartSettingsModal','void BLBacklogChart.openSettings()','backlog'],
 ['backlog-plan-detail','bpaDrawer',"if(document.getElementById('backlogPlanActual').hidden)document.getElementById('backlogPlanActualToggle').click();setTimeout(()=>document.querySelector('[data-bpa-open]')?.click(),600)",'backlog'],
 ['intake-filter','intakeFilterPanel',"document.querySelector('[data-home-page-tab=\"1\"]')?.click();document.getElementById('intakeFiltersBtn').click()",'overview'],
 ['quotation-access','quotationAccessModal',"document.querySelector('[data-manage-quotation-access]')?.click()",'quotations'],
 ['quotation-note','quotationNoteModal',"document.querySelector('[data-quotation-note]')?.click()",'quotations'],
 ['lfl-trial','_lflTrialModal',"document.getElementById('lflTrialBtn').click()",'lfl'],
 ['user-create','.umDialogOverlay',"BLUserManagement.open()",'cp'],
];
let s=fs.readFileSync(path.join(__dirname,'matrix-rare.cjs'),'utf8'),a=s.indexOf('const cases=['),b=s.indexOf('\n(async()=>',a);s=s.slice(0,a)+'const cases='+JSON.stringify(cases)+';'+s.slice(b);s=s.replace('phase-3/matrix/rare','phase-3/matrix/last').replaceAll("'#'+id","(id.startsWith('.')?id:'#'+id)");
s=s.replace("if(!process.env.BL_RARE_ONLY){await tab('cp');await page.evaluate(()=>showAppBlockingOperation('source'));await shot('blocking-operation');await page.evaluate(()=>hideAppBlockingOperation());}",'');
s=s.replace('const shot=require(',`const base=new URL(page.url()).origin;await context.route(base+'/api/model-connections',r=>r.request().method()==='GET'?r.fulfill({json:{supported:true,revision:0,items:[{id:'demo-asas',name:'DEMO ASAS',role:'asas',server:'DEMO-MODEL',catalog:'Demo ASAS'}]}}):r.abort());await context.route(base+'/api/model-connections/schema',r=>r.fulfill({json:{columns:[{table:'Demo Orders',name:'Order Date',kind:'column'},{table:'Demo Orders',name:'Quantity',kind:'column'}]}}));await tab('quotations');await page.evaluate(async()=>{await BL_QUOTATIONS.desk.ready();if(!BL_QUOTATIONS.desk.requests().length)await BL_QUOTATIONS.recordRequest('collection',kolRows.slice(0,3),[{name:'DEMO TRIKO',email:''}]);BL_QUOTATIONS.desk.selectRequest(BL_QUOTATIONS.desk.requests()[0]?.id);BLPricingDesk.renderLanguage();});const shot=require(`);
s=s.replace("await page.locator((id.startsWith('.')?id:'#'+id)).waitFor", "if(name==='user-create')await page.locator('[data-act=newUser]').click();await page.locator((id.startsWith('.')?id:'#'+id)).waitFor");
s=s.replace('await shot(name);',"await page.locator((id.startsWith('.')?id:'#'+id)).scrollIntoViewIfNeeded();await shot(name);");
const generated=new Module(path.join(__dirname,'matrix-last-generated.cjs'),module);generated.filename=path.join(__dirname,'matrix-last-generated.cjs');generated.paths=module.paths;generated._compile(s,generated.filename);
