'use strict';
// Gerçek editörün tek yapıştırma etkileşimini aynı Chromium'da Main/adaya uygular.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),{extractFunction}=require(path.join(root,'resources/app/tests/helpers/app-main-functions'));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const sourcePath='resources/app/public/app-main.js',base=process.env.NOTE_BASE_REF||'b54f62fccffa7af95549a1fbf8315756b325fe5d';
const names=['todoText','todoToolbar','todoSanitize','trimRichNoteClipboard','copyRichNoteSelection','bindRichNoteEditor'];
const fixtures=[{name:'main',source:execFileSync('git',['show',`${base}:${sourcePath}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024})},{name:'candidate',source:fs.readFileSync(path.join(root,sourcePath),'utf8')}];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 const results=[];
 try{
  for(const fixture of fixtures){
   const page=await browser.newPage();
   await page.setContent('<style>:root{--ui-text:#18212a;--ui-warning:#806000}.editor{white-space:pre-wrap;width:900px;min-height:500px}</style><section id="host"></section>');
   await page.addScriptTag({content:`var appLang='en';function showToast(){};function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}\n`+names.map(name=>extractFunction(fixture.source,name)).join('\n')});
   const sample=await page.evaluate(async()=>{
    const host=document.getElementById('host');host.innerHTML=todoToolbar()+'<div class="editor" contenteditable="true"></div>';
    const editor=host.querySelector('.editor');bindRichNoteEditor(host,editor);editor.focus();
    const range=document.createRange();range.selectNodeContents(editor);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);
    const text='Print approval pending. Parcel received 22.10.',data=new DataTransfer();
    data.setData('text/plain',text);data.setData('text/html','<div><br></div><div><br></div><div><b>'+text+'</b></div><div><br></div>');
    await new Promise(requestAnimationFrame);const start=performance.now();
    editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    const renderedText=editor.innerText,synchronousMs=performance.now()-start;
    await new Promise(requestAnimationFrame);
    return {synchronousMs,feedbackMs:performance.now()-start,text:renderedText,html:editor.innerHTML};
   });
   results.push({name:fixture.name,...sample});await page.close();
  }
  console.log(JSON.stringify({base,node:process.version,browser:browser.version(),fixture:'two leading empty divs, bold one-line note, one trailing empty div',samples:results},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
