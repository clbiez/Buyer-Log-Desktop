'use strict';
const path=require('node:path');
const F=require('./files');
const {fail}=require('./signature');

// Invoked only by the installed launcher. No renderer-supplied filesystem path.
async function prepareFromPicker({manager,dialog,window,language='tr',authorize}){
 const en=language==='en',text=(tr,english)=>en?english:tr;
 if(!await authorize())fail('UPDATE_ADMIN_REQUIRED','Yalnız moderatör yama hazırlayabilir.','Only a moderator can prepare a patch.');
 const picked=await dialog.showOpenDialog(window,{title:text('İmzalı yama tanımını seçin','Select signed patch manifest'),properties:['openFile'],filters:[{name:'Buyer Log signed patch',extensions:['json']}]});
 if(picked.canceled||picked.filePaths?.length!==1)return {ok:false,cancelled:true};
 const file=path.resolve(picked.filePaths[0]),manifest=F.readJsonStrict(file),preview=manager.preview(manifest);
 const answer=await dialog.showMessageBox(window,{type:'question',defaultId:1,cancelId:1,
  title:text('İmzalı yamayı hazırla','Prepare signed patch'),buttons:[text('Doğrula ve hazırla','Verify and prepare'),text('Vazgeç','Cancel')],
  message:text(`Buyer Log ${preview.baseVersion} · Yama ${preview.sequence}`,`Buyer Log ${preview.baseVersion} · Patch ${preview.sequence}`),
  detail:text(`${preview.changes} dosya değişikliği. İmza doğrulandı.\n${preview.releaseNotes.tr}\n\nKaydedilmemiş işinizi tamamladıktan sonra yeniden başlatın.`,`${preview.changes} file changes. Publisher signature verified.\n${preview.releaseNotes.en}\n\nRestart after completing your unsaved work.`)});
 if(answer.response!==0)return {ok:false,cancelled:true};
 if(!await authorize())fail('UPDATE_ADMIN_REQUIRED','Moderatör yetkisi değişti; yama hazırlanmadı.','Moderator authority changed; the patch was not prepared.');
 return manager.apply(manifest,path.join(path.dirname(file),manifest.artifact.name));
}
module.exports={prepareFromPicker};
