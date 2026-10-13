'use strict';
function automationAnalyze(rows,config={}){
  const list=Array.isArray(rows)?rows:[],groupBy=String(config.groupBy||'').trim(),valueField=String(config.valueField||'').trim(),op=String(config.operation||'count').trim().toLowerCase(),topN=Math.max(1,Math.min(50,Number(config.topN)||15));
  if(!groupBy)return {operation:'count',total:list.length,groups:[]};
  const groups=new Map();
  for(const row of list){const key=String(row&&row[groupBy]==null?'(boş)':row[groupBy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const calc=items=>{if(op==='count'||!valueField)return items.length;const nums=items.map(row=>Number(row&&row[valueField])).filter(Number.isFinite);if(!nums.length)return 0;if(op==='sum')return nums.reduce((a,b)=>a+b,0);if(op==='avg')return nums.reduce((a,b)=>a+b,0)/nums.length;if(op==='min')return Math.min(...nums);if(op==='max')return Math.max(...nums);return items.length;};
  const result=[...groups.entries()].map(([key,items])=>({key,count:items.length,value:calc(items)})).sort((a,b)=>Number(b.value)-Number(a.value)||b.count-a.count).slice(0,topN);
  return {operation:op,groupBy,valueField,total:list.length,groups:result};
}
function createAutomationExecutor(deps){
 const {automationDataset,automationAnalyze,automationRunAppActions,automationSteps,agentBrowserConnector,automationSplitRecipients,automationEmailGroup,automationEmail,backlogAutomation}=deps;
async function automationExecute(ownerId,profile,recipe,{dryRun=false,trigger='manual',dataset=null,assertAuthority=()=>{},draftOwnerId='',draftUrl=null,draftScope=null,onSourceRefresh=()=>{},runDraft=work=>work()}={}){
  profile=await assertAuthority()||profile;
  let data=dataset||await automationDataset(ownerId,profile,recipe),items=data.items||[],rows=data.items||[];
  profile=await assertAuthority()||profile;
  const purpose=recipe.purpose||'browser',result={purpose,total:data.total,matched:data.matched,willProcess:data.items?data.items.length:1,sample:data.sample,processed:0,failed:0};if(data.join)result.join=data.join;
  if(draftOwnerId&&draftScope)result.agentScope=draftScope;
  if(['app','mixed'].includes(purpose)) Object.assign(result,await automationRunAppActions(ownerId,profile,recipe,dryRun,assertAuthority,onSourceRefresh));
  if(!dryRun&&['app','mixed'].includes(purpose)&&(recipe.appActions||[]).some(action=>action.action==='refresh_source')){
    profile=await assertAuthority()||profile;
    data=await automationDataset(ownerId,profile,recipe);
    profile=await assertAuthority()||profile;
    items=rows=data.items||[];Object.assign(result,{total:data.total,matched:data.matched,willProcess:items.length,sample:data.sample});if(data.join)result.join=data.join;
  }
  result.changeBaseline=data.changeBaseline||null;
  if(data.change&&data.change.configured){result.change=data.change;if(!data.matched){result.processed=0;result.skipped=data.change.baselineReady?'no_change':'baseline_created';return result;}}
  if(['analysis','app','email','mixed'].includes(purpose)) result.analysis=automationAnalyze(rows,recipe.analysis||{});
  if(purpose==='browser'||purpose==='mixed'&&((recipe.steps||[]).length||String(recipe.terminalCode||'').trim())){
    const steps=automationSteps(recipe);if(!steps.length)throw Object.assign(new Error('Önce web adımlarını kaydedin veya Terminal Kodu yazın.'),{code:'AUTOMATION_STEPS_EMPTY',statusCode:400});
    const browser=await agentBrowserConnector.run(ownerId,{url:recipe.url,steps,items:data.items||undefined,timeoutMs:recipe.timeoutMs,continueOnError:recipe.continueOnError},{dryRun});
    result.browser=browser;result.processed=Number(browser.processed)||0;result.failed=Number(browser.failed)||0;result.steps=browser.actions||[];
  } else result.processed=data.items?data.items.length:1;
  const completedDrafts=[];
  try { if(['email','mixed'].includes(purpose)){
    const email=recipe.email||{},fields=(email.reportFields||[]).filter(Boolean);
    const baseSubject=email.subject||recipe.name;
    // E-posta otomasyonları güvenli taslak üretim yolunu kullanır.
    /* v9.47 — Bir grubun yazışma dili. 'auto' kipinde karar satırların kendi
       verisinden gelir; grup içinde karışıklık varsa çoğunluk kazanır (bir
       üreticinin tek bir maili olacak, iki dilde yazılamaz). İngilizce metin
       tanımlı değilse Türkçesi kullanılır. */
    const groupLanguage=mailRows=>{
      if(email.languageMode==='tr'||email.languageMode==='en')return email.languageMode;
      if(email.languageMode!=='auto')return 'tr';
      let en=0,tr=0;
      for(const row of (mailRows||[]))(backlogAutomation.resolveCommunicationLanguage(row)==='en'?en++:tr++);
      return en>tr?'en':'tr';
    };
    const deliver=async(group,subjectBase,mailRows,langRows)=>{
      const lang=groupLanguage(langRows||mailRows);
      const useEn=lang==='en'&&(email.subjectEn||email.bodyEn);
      const subject=useEn&&email.subjectEn?String(subjectBase).replace(baseSubject,email.subjectEn):subjectBase;
      const body=useEn&&email.bodyEn?email.bodyEn:email.body;
      const entry={groupId:group.id,groupName:group.name,to:group.to,cc:group.cc,bcc:group.bcc,subject,rows:mailRows.length,deliveryMode:email.deliveryMode,language:lang};
      profile=await assertAuthority()||profile;
      if(dryRun)return entry;
      const open=!draftOwnerId&&trigger==='manual'&&email.openDraftOnManual!==false;
      const draft=await runDraft(()=>automationEmail.createDraft({name:recipe.name,to:group.to,cc:group.cc,bcc:group.bcc,subject,body,rows:mailRows,fields,language:lang,ownerId:draftOwnerId,open}));
      const receipt={...entry,filename:draft.filename,opened:draft.opened,draftUrl:draftUrl?draftUrl(draft.filename):`/api/automations/mail-drafts/${encodeURIComponent(draft.filename)}`};
      completedDrafts.push(receipt);return receipt;
    };
    if(email.recipientMode==='field'){
      const split=automationSplitRecipients(rows,recipe,ownerId);
      if(!split.resolved.length)throw Object.assign(new Error(split.responsible?'Hiçbir siparişin sorumlu üreticisi için e-posta adresli bir Üretici kartı bulunamadı; e-posta gönderilmedi. Üreticiler sayfasından kartları ASAS adlarıyla eşleyin.':`"${split.field}" alanındaki hiçbir değer adres defterinde bulunamadı; e-posta gönderilmedi.`),{code:'AUTOMATION_RECIPIENTS_UNRESOLVED',statusCode:400,details:{unresolved:split.unresolved.slice(0,50)}});
      const messages=[];
      for(const part of split.resolved)messages.push(await deliver(part.group,`${baseSubject} · ${part.value}`,email.includeReport===false?[]:part.rows,part.rows));
      result.emails=messages;
      result.email={...messages[0],split:true,messageCount:messages.length,recipientField:split.field,responsibleManufacturer:Boolean(split.responsible)};
      // Çözülemeyen değerler sonuçta AÇIKÇA raporlanır; kullanıcı hangi
      // üretici/ülke için e-posta gitmediğini görmeden devam etmemeli.
      if(split.unresolved.length)result.unresolvedRecipients=split.unresolved;
    }else{
      const group=automationEmailGroup(recipe,ownerId);
      result.email=await deliver(group,baseSubject,email.includeReport===false?[]:rows,rows);
    }
  }
  await assertAuthority();
  }catch(err){if(completedDrafts.length)err.details={...err.details,automationReceipt:{...result,emails:completedDrafts,email:completedDrafts[0],failed:1,outcome:'partial',interrupted:true}};throw err;}
  result.changeBaseline=data.changeBaseline||null;
  result.truncated=data.matched>(data.items?.length??data.matched);
  result.outcome=result.failed||result.unresolvedRecipients?.length||result.truncated?'partial':'completed';
  return result;
}
return automationExecute;
}
module.exports={createAutomationExecutor,automationAnalyze};
