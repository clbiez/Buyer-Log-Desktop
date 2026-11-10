/* Fabric Card 02/B editor: source-language input, automatic TR/EN translation,
 * opt-in per-part overrides and fixed separator preview. No background writes. */
(function(root){
  'use strict';
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function mount(container,options){
    const engine=root.BLFabricSegments,card=options.card||{},en=options.uiLanguage==='en';
    if(!engine || !container)return null;
    const L=(tr,eng)=>en?eng:tr;
    const labels=[L('Kumaş türü','Fabric type'),L('İplik','Yarn'),L('Gramaj','Weight'),L('İçerik','Composition')];
    const rawCard=clone(card),cache=new Map(),timers=[null,null,null,null],tokens=[0,0,0,0];
    let destroyed=false,source=options.sourceLanguage==='en'?'en':'tr';
    let pieces=engine.fromCard(card),values={tr:pieces.tr.slice(),en:pieces.en.slice()};
    let overrides={tr:[false,false,false,false],en:[false,false,false,false]};
    let states=['ready','ready','ready','ready'],stale=[false,false,false,false];
    function resetOverrides(next){
      overrides={tr:[false,false,false,false],en:[false,false,false,false]};
      for(const lang of ['tr','en'])for(let i=0;i<4;i++)overrides[lang][i]=Boolean(next&&next[lang]&&next[lang][i]);
    }
    resetOverrides(card.translationOverrides);
    const initial=JSON.stringify({values,overrides});
    const target=()=>source==='tr'?'en':'tr';
    const statusText=(value)=>({
      ready:'',translating:L('Çevriliyor…','Translating…'),
      translated:L('Otomatik çevrildi','Auto translated'),
      manual:L('Elle düzeltildi','Manually edited'),
      stale:L('Kaynak değişti; çeviriyi onaylayın','Source changed; review translation'),
      failed:L('Çeviri başarısız; elle düzeltin','Translation failed; edit manually'),
      invalid:L('Geçersiz parça','Invalid segment'),
      review:L('Teknik yazımı kontrol edin','Check technical notation')
    })[value]||'';
    function callDirty(){options.onDirty?.();}
    function preview(){
      const tr=engine.compose(values.tr),eng=engine.compose(values.en);
      const a=container.querySelector('[data-preview="tr"]'),b=container.querySelector('[data-preview="en"]');
      if(a)a.textContent=tr||L('Parçaları tamamlayın','Complete the segments');
      if(b)b.textContent=eng||L('Parçaları tamamlayın','Complete the segments');
      const warning=container.querySelector('[data-segment-warning]');
      if(warning)warning.hidden=!pieces.legacy;
      const invalid=container.querySelector('[data-segment-validation]');
      if(invalid){const result=canSave();invalid.hidden=result.ok;invalid.textContent=result.ok?'':result.message;}
    }
    function repaint(){
      for(let i=0;i<4;i++){
        for(const lang of ['tr','en']){
          const input=container.querySelector('[data-part="'+lang+':'+i+'"]');
          if(!input)continue;
          if(input!==document.activeElement)input.value=values[lang][i];
          input.readOnly=lang!==source&&!overrides[lang][i];
          input.dataset.mode=lang===source?'source':overrides[lang][i]?'manual':'automatic';
        }
        const status=container.querySelector('[data-segment-status="'+i+'"]');
        if(status){status.textContent=statusText(stale[i]?'stale':states[i]);status.dataset.state=stale[i]?'stale':states[i];}
        const edit=container.querySelector('[data-segment-action="edit:'+i+'"]');
        const auto=container.querySelector('[data-segment-action="auto:'+i+'"]');
        const confirm=container.querySelector('[data-segment-action="confirm:'+i+'"]');
        if(edit)edit.hidden=Boolean(overrides[target()][i]);
        if(auto)auto.hidden=!overrides[target()][i];
        if(confirm)confirm.hidden=!stale[i];
      }
      preview();
      callDirty();
    }
    function canSave(){
      if(states.some(x=>x==='translating'||x==='failed'||x==='invalid'||x==='review')||stale.some(Boolean))
        return {ok:false,message:L('Çevirileri tamamlayın veya manuel olarak düzeltin.','Complete translations or edit them manually.')};
      const checked=engine.validatePair(values.tr,values.en);
      return checked.ok?{ok:true}:{ok:false,message:L('Dört parçada ayraç, iplik, gramaj ve sayısal değerleri kontrol edin.','Check separators, yarn, weight and numeric values in all four segments.')};
    }
    function cancel(index){if(timers[index])clearTimeout(timers[index]);timers[index]=null;tokens[index]++;}
    async function requestAI(index,lang,other,text,token){
      const key=lang+'|'+other+'|'+engine.FIELDS[index]+'|'+text;
      let answer=cache.get(key);
      if(!answer){
        try{
          if(!root.BuyerLogAI)await root.BLPerf?._loadScript?.('lcwai-assistant.js?rev=1');
          if(typeof root.BuyerLogAI?.ask!=='function')throw Error('LCW_AI_UNAVAILABLE');
          const result=await root.BuyerLogAI.ask({
            source:'fabric-segment-translation',lang:other,
            task:lang==='tr'?'Translate this textile fragment into English.':'Translate this textile fragment into Turkish.',
            context:{text,field:engine.FIELDS[index],sourceLanguage:lang,targetLanguage:other}
          });
          answer=String(result?.data?.translation||result?.structured?.partial?.translation||'').trim();
          if(!engine.validPiece(answer)||!engine.numbersMatch(text,answer))throw Error('INVALID_TRANSLATION');
          if(cache.size>160)cache.clear();cache.set(key,answer);
        }catch(error){
          if(!destroyed&&tokens[index]===token&&source===lang&&!overrides[other][index]){
            states[index]='failed';repaint();
          }
          return;
        }
      }
      if(destroyed||tokens[index]!==token||source!==lang||values[lang][index]!==text||overrides[other][index])return;
      values[other][index]=answer;states[index]='translated';stale[index]=false;repaint();
    }
    function translate(index){
      cancel(index);
      const lang=source,other=target(),text=engine.clean(values[lang][index]),token=tokens[index];
      if(!engine.validPiece(text)){states[index]='invalid';if(!overrides[other][index])values[other][index]='';repaint();return;}
      if(overrides[other][index]){states[index]='manual';stale[index]=true;repaint();return;}
      const known=engine.translateKnown(text,engine.FIELDS[index],lang);
      if(known.status==='known'){
        values[other][index]=known.value;
        if(index===2){values[lang][index]=engine.weight(text)||text;}
        if(index===1){values[lang][index]=text.replace(/\s*\/\s*/g,'/');}
        states[index]='translated';stale[index]=false;repaint();return;
      }
      if(known.status==='needs-review'){
        // Yarn count must not be sent to AI for reinterpretation.
        states[index]='review';repaint();return;
      }
      if(known.status!=='needs-ai'){states[index]='invalid';repaint();return;}
      states[index]='translating';repaint();
      timers[index]=setTimeout(()=>{timers[index]=null;void requestAI(index,lang,other,text,token);},550);
    }
    function render(){
      const names=[L('TÜR','TYPE'),L('İPLİK','YARN'),L('GRAMAJ','WEIGHT'),L('İÇERİK','COMPOSITION')];
      container.innerHTML='<div class="fabricSegmentBar"><div><strong>'+esc(L('Parçalı özet','Segmented summary'))+'</strong><small>'+esc(L('Özet: 4 parça · 3 sabit nokta','Summary: 4 segments · 3 fixed dots'))+'</small></div>'
        +'<label>'+esc(L('Kaynak dil','Source language'))+'<select data-source-language><option value="tr"'+(source==='tr'?' selected':'')+'>Türkçe</option><option value="en"'+(source==='en'?' selected':'')+'>English</option></select></label></div>'
        +'<p data-segment-warning class="fabricSegmentNotice"'+(pieces.legacy?'':' hidden')+'>'+esc(L('Eski özet güvenle dört parçaya ayrılamadı. Orijinal özet kayıt edilene kadar korunur.','The previous summary could not be safely split. Its original text remains intact until you save.'))+'<span class="fabricSegmentLegacy">'+esc(rawCard.summary||'')+' / '+esc(rawCard.summaryEn||'')+'</span></p>'
        +'<div class="fabricSegmentHeading"><span>'+esc(L('Alan','Field'))+'</span><span>TR</span><span>EN</span><span>'+esc(L('Çeviri','Translation'))+'</span></div>'
        +names.map((name,i)=>'<div class="fabricSegmentRow" data-segment-row="'+i+'">'
          +'<span class="fabricSegmentName">'+esc(name)+(i<3?'<b aria-hidden="true"> · </b>':'')+'</span>'
          +'<input type="text" data-part="tr:'+i+'" aria-label="'+esc(labels[i]+' / Türkçe')+'" lang="tr" value="'+esc(values.tr[i])+'">'
          +'<input type="text" data-part="en:'+i+'" aria-label="'+esc(labels[i]+' / English')+'" lang="en" value="'+esc(values.en[i])+'">'
          +'<div class="fabricSegmentAction"><button type="button" class="tbtn" data-segment-action="edit:'+i+'">'+esc(L('Çeviriyi düzenle','Edit translation'))+'</button>'
          +'<button type="button" class="tbtn" data-segment-action="auto:'+i+'" hidden>'+esc(L('Otomatik çeviriye dön','Use auto translation'))+'</button>'
          +'<button type="button" class="tbtn" data-segment-action="confirm:'+i+'" hidden>'+esc(L('Onayla','Confirm'))+'</button>'
          +'<small aria-live="polite" data-segment-status="'+i+'"></small></div></div>').join('')
        +'<section class="fabricSegmentPreview"><strong>'+esc(L('Tablodaki canlı özet','Live table summary'))+'</strong><p><small>TR</small> <output data-preview="tr"></output></p><p><small>EN</small> <output data-preview="en"></output></p></section>'
        +'<p class="fabricSegmentError" data-segment-validation role="status" hidden></p>';
      repaint();
      root.BLMotionPlus?.play?.('card',container);
    }
    const onInput=event=>{
      const part=event.target.closest?.('[data-part]');
      if(!part||!container.contains(part))return;
      const [lang,n]=part.dataset.part.split(':'),i=Number(n);
      values[lang][i]=part.value;
      pieces.legacy=false;
      if(lang===source){translate(i);}
      else if(overrides[lang][i]){states[i]='manual';stale[i]=false;repaint();}
    };
    const onChange=event=>{
      if(event.target.matches?.('[data-source-language]')){
        source=event.target.value==='en'?'en':'tr';
        // All user-entered values and manual overrides survive language switching.
        for(let i=0;i<4;i++)cancel(i);
        states=['ready','ready','ready','ready'];stale=[false,false,false,false];
        render();
        for(let i=0;i<4;i++)if(!values[target()][i]&&!overrides[target()][i])translate(i);
      }
    };
    const onClick=event=>{
      const button=event.target.closest?.('[data-segment-action]');
      if(!button||!container.contains(button))return;
      const [action,num]=button.dataset.segmentAction.split(':'),i=Number(num),other=target();
      cancel(i);
      if(action==='edit'){overrides[other][i]=true;states[i]='manual';stale[i]=false;repaint();container.querySelector('[data-part="'+other+':'+i+'"]')?.focus();}
      if(action==='auto'){overrides[other][i]=false;stale[i]=false;translate(i);}
      if(action==='confirm'&&overrides[other][i]){stale[i]=false;states[i]='manual';repaint();}
    };
    container.addEventListener('input',onInput);
    container.addEventListener('change',onChange);
    container.addEventListener('click',onClick);
    render();
    for(let i=0;i<4;i++)if(!values[target()][i]&&values[source][i])translate(i);
    return {
      canSave,
      result(){
        const checked=canSave();
        if(!checked.ok)return {ok:false,error:checked.message};
        return {ok:true,summary:engine.compose(values.tr),summaryEn:engine.compose(values.en),
          summarySegments:clone(values),translationOverrides:clone(overrides),segmentSourceLang:source};
      },
      fill(newCard){
        for(let i=0;i<4;i++)cancel(i);
        pieces=engine.fromCard(newCard||{});
        values={tr:pieces.tr.slice(),en:pieces.en.slice()};
        resetOverrides(newCard&&newCard.translationOverrides);
        states=['ready','ready','ready','ready'];stale=[false,false,false,false];
        render();for(let i=0;i<4;i++)if(!values[target()][i]&&values[source][i])translate(i);
      },
      isDirty(){return JSON.stringify({values,overrides})!==initial;},
      dispose(){
        destroyed=true;for(let i=0;i<4;i++)cancel(i);
        container.removeEventListener('input',onInput);
        container.removeEventListener('change',onChange);
        container.removeEventListener('click',onClick);
      }
    };
  }
  root.BLFabricSegmentUI=Object.freeze({mount});
})(typeof window!=='undefined'?window:globalThis);
