'use strict';

const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const {SERVER_DATA_ROOT}=require('../user-data');
const platform=require('./platform');

const ROOT=path.join(SERVER_DATA_ROOT,'automation-mail-drafts');
function clean(v){return String(v==null?'':v).trim();}
function ensure(){fs.mkdirSync(ROOT,{recursive:true});}
function safeName(v){return (clean(v)||'BuyerLog_Automation').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,90);}
function htmlEscape(v){return String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function csvCell(v){const s=String(v==null?'':v).replace(/\r?\n/g,' ');return /[",;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csv(rows,fields){return [fields.join(';'),...rows.map(row=>fields.map(field=>csvCell(row&&row[field])).join(';'))].join('\r\n');}
function tableHtml(rows,fields){if(!rows.length)return '<p>Eşleşen kayıt bulunamadı.</p>';const head=fields.map(f=>`<th>${htmlEscape(f)}</th>`).join('');const body=rows.slice(0,200).map(row=>`<tr>${fields.map(f=>`<td>${htmlEscape(row&&row[f])}</td>`).join('')}</tr>`).join('');return `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:11px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${rows.length>200?`<p>İlk 200 kayıt gösterildi. Toplam: ${rows.length}</p>`:''}`;}
function b64(buf){return Buffer.from(buf).toString('base64').replace(/(.{76})/g,'$1\r\n');}
function eml({to=[],cc=[],bcc=[],subject='',html='',plain='',attachment=null}){
  const mixed=`bl_${crypto.randomBytes(8).toString('hex')}`;const alt=`alt_${crypto.randomBytes(8).toString('hex')}`;const lines=[];
  lines.push(`To: ${to.join('; ')}`);if(cc.length)lines.push(`Cc: ${cc.join('; ')}`);if(bcc.length)lines.push(`Bcc: ${bcc.join('; ')}`);lines.push(`Subject: ${subject.replace(/[\r\n]+/g,' ')}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${mixed}"`,'',`--${mixed}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',`--${alt}`,'Content-Type: text/plain; charset="utf-8"','Content-Transfer-Encoding: 8bit','',plain||subject,'',`--${alt}`,'Content-Type: text/html; charset="utf-8"','Content-Transfer-Encoding: 8bit','',html,'',`--${alt}--`);
  if(attachment){lines.push(`--${mixed}`,`Content-Type: text/csv; charset="utf-8"; name="${attachment.filename}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${attachment.filename}"`,'',b64(Buffer.from(attachment.content,'utf8')));}
  lines.push(`--${mixed}--`,'');return lines.join('\r\n');
}
function createDraft({name='Automation',to=[],cc=[],bcc=[],subject='',body='',rows=[],fields=[],open=false}){
  ensure();const selected=fields.length?fields:[...new Set(rows.slice(0,80).flatMap(r=>Object.keys(r||{})))].slice(0,20);const report=tableHtml(rows,selected);const html=`<div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.5">${body?`<p>${htmlEscape(body).replace(/\n/g,'<br>')}</p>`:''}<p><b>Buyer Log otomasyon raporu</b> · ${rows.length} kayıt</p>${report}</div>`;const plain=`${body?body+'\n\n':''}Buyer Log otomasyon raporu - ${rows.length} kayıt`;
  const attachment=rows.length&&selected.length?{filename:`${safeName(name)}_Report.csv`,content:csv(rows,selected)}:null;const filename=`${safeName(name)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.eml`;const fullPath=path.join(ROOT,filename);fs.writeFileSync(fullPath,eml({to,cc,bcc,subject,html,plain,attachment}),'utf8');const opened=open?platform.openPathExternallyAsync(fullPath):false;return{filename,fullPath,opened,rows:rows.length,fields:selected};
}
function sendWithOutlook({to=[],cc=[],bcc=[],subject='',body='',rows=[],fields=[],name='Automation'}){
  if(!platform.IS_WINDOWS)return{ok:false,error:'Outlook otomatik gönderimi yalnız Windows üzerinde destekleniyor.'};
  ensure();const selected=fields.length?fields:[...new Set(rows.slice(0,80).flatMap(r=>Object.keys(r||{})))].slice(0,20);const attachment=rows.length&&selected.length?path.join(ROOT,`${safeName(name)}_${Date.now()}_Report.csv`):'';if(attachment)fs.writeFileSync(attachment,csv(rows,selected),'utf8');const payload={to:to.join(';'),cc:cc.join(';'),bcc:bcc.join(';'),subject,html:`<div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.5">${body?`<p>${htmlEscape(body).replace(/\n/g,'<br>')}</p>`:''}<p><b>Buyer Log otomasyon raporu</b> · ${rows.length} kayıt</p>${tableHtml(rows,selected)}</div>`,attachment};const payloadPath=path.join(os.tmpdir(),`buyerlog-auto-mail-${process.pid}-${Date.now()}.json`);fs.writeFileSync(payloadPath,JSON.stringify(payload),'utf8');const script=path.join(__dirname,'SendAutomationMail.ps1');try{const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-PayloadPath',payloadPath],{windowsHide:true,timeout:45000,encoding:'utf8'});if(r.error||r.status!==0)return{ok:false,error:clean(r.stderr||r.stdout||r.error&&r.error.message)||'Outlook gönderimi başarısız.'};return{ok:true,sent:true,rows:rows.length,fields:selected};}finally{try{fs.unlinkSync(payloadPath);}catch(_){} }
}
function draftPath(filename){const base=path.basename(clean(filename));if(!base||base!==clean(filename))return'';const full=path.join(ROOT,base);return fs.existsSync(full)?full:'';}
module.exports={ROOT,createDraft,sendWithOutlook,draftPath,tableHtml,csv};
