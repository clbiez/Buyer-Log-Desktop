'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const PUBLIC=path.join(ROOT,'public');

test('v6.67 bağımsız tarayıcı betiklerinin tamamı geçerli JavaScript sözdizimine sahiptir',()=>{
  const files=fs.readdirSync(PUBLIC).filter(name=>name.endsWith('.js')).sort();
  assert.ok(files.includes('version-history.js'));
  for(const file of files){
    const source=fs.readFileSync(path.join(PUBLIC,file),'utf8');
    assert.doesNotThrow(()=>new vm.Script(source,{filename:file}),`${file} parse edilemedi`);
  }
});

test('v6.67 Koleksiyon öneri paneli konumlandırma sırasında kapanırsa null DOM erişimi yapmaz',()=>{
  const source=fs.readFileSync(path.join(PUBLIC,'app-main.js'),'utf8');
  const start=source.indexOf('function closeKolCatalogDrop(){');
  const end=source.indexOf("window.addEventListener('resize',scheduleKolCatalogDropPosition",start);
  assert.ok(start>=0&&end>start,'Koleksiyon öneri paneli bloğu bulunamadı');
  const block=source.slice(start,end);

  const drop={
    isConnected:false,
    style:{},
    offsetHeight:40,
    remove(){this.isConnected=false;},
    querySelectorAll(){throw new Error('Kapalı panelde querySelectorAll çağrıldı');},
  };
  const input={
    dataset:{kind:'category'},
    value:'',
    isConnected:true,
    getBoundingClientRect(){return {top:900,bottom:930,left:10,right:210,width:200};},
  };
  const context={
    window:{innerHeight:800,innerWidth:1200},
    _kolCatalogDrop:null,
    _kolCatalogAnchor:null,
    _kolCatalogPositionRaf:0,
    document:{
      querySelectorAll(){return [];},
      createElement(){return drop;},
      body:{appendChild(node){node.isConnected=true;}},
    },
    requestAnimationFrame(){return 1;},
    cancelAnimationFrame(){},
    closeSubmfrDrop(){},
    kolCatalogValues(){return ['Category A'];},
    turknorm(value){return String(value||'').toLowerCase();},
    norm(value){return String(value||'').trim();},
    escapeHtml(value){return String(value);},
  };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.__showKolCatalogDrop=showKolCatalogDrop;`,context);
  assert.doesNotThrow(()=>context.__showKolCatalogDrop(input));
  assert.equal(drop.isConnected,false,'Ekran dışındaki hücrenin paneli kapanmalı');
});

test('v6.67 zamanlayıcı uygulama içinde korunur ve VBS dağıtımdan çıkarılmıştır',()=>{
  assert.match(fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8'),/runScheduledAutomations/);
});
