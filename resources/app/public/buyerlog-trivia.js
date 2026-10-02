/* Buyer Log · açılış ekranı "Biliyor muydunuz?" kartları.
 * Görseller yerel, kategoriye özgü SVG sahneleridir; uzak varlık veya iş verisi yok.
 * Her kartın süsleri kimliğinden türeyen tohumla değişir, böylece aynı kategori
 * içindeki kartlar da birbirinden farklı görünür.
 */
(function(global){
  'use strict';
  const data=global.BLTriviaData;
  if(!data||!Array.isArray(data.items)||!data.items.length)return;
  const SEEN_KEY='bl.trivia.seen.v1';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categoryFor=id=>data.categories.find(c=>c.id===id)||data.categories[0];
  const pick=(obj,lang)=>obj?.[lang]||obj?.tr||'';
  function seedOf(text){let h=2166136261;for(const ch of String(text)){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function rng(seed){let a=seed||1;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
  const n=v=>Math.round(v*10)/10;
  const W=520,H=260;

  // Kategori sahneleri: yalnız tema token'larıyla boyanan sınıflar kullanılır (CSS).
  const scenes={
    space(r){
      let stars='';for(let i=0;i<34;i++)stars+=`<circle class="f${i%4?'':' tw'}" style="animation-delay:${n(r()*3)}s" cx="${n(r()*W)}" cy="${n(r()*H)}" r="${n(.6+r()*1.8)}"/>`;
      const px=260+r()*110,py=110+r()*40,pr=48+r()*20;
      return `${stars}<path class="s thin" d="M${n(30+r()*80)} ${n(20+r()*40)}l70 26" opacity=".7"/><circle class="f2 s" cx="${n(px)}" cy="${n(py)}" r="${n(pr)}"/><path class="s thin" d="M${n(px-pr*.7)} ${n(py-pr*.25)}q${n(pr*.7)} ${n(pr*.3)} ${n(pr*1.4)} 0M${n(px-pr*.85)} ${n(py+pr*.2)}q${n(pr*.85)} ${n(pr*.25)} ${n(pr*1.7)} 0" opacity=".6"/><ellipse class="s" cx="${n(px)}" cy="${n(py)}" rx="${n(pr*1.75)}" ry="${n(pr*.38)}" transform="rotate(-14 ${n(px)} ${n(py)})"/><g class="spin" style="transform-origin:${n(px)}px ${n(py)}px"><circle class="f" cx="${n(px+pr*2.15)}" cy="${n(py)}" r="7"/></g><circle class="s thin dash" cx="${n(px)}" cy="${n(py)}" r="${n(pr*2.15)}" opacity=".35"/>`;
    },
    ocean(r){
      let bubbles='';for(let i=0;i<14;i++)bubbles+=`<circle class="s thin rise" style="animation-delay:${n(r()*6)}s;animation-duration:${n(5+r()*4)}s" cx="${n(30+r()*460)}" cy="${n(150+r()*90)}" r="${n(2+r()*6)}"/>`;
      let fish='';for(let i=0;i<3;i++){const x=60+r()*360,y=110+r()*90,s=.7+r()*.7;fish+=`<g class="swim" style="animation-delay:${n(r()*4)}s"><g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><path class="f2 s" d="M0 0q22-16 44 0q-22 16-44 0zM44 0l14-10v20z"/><circle class="f" cx="10" cy="-2" r="2"/></g></g>`;}
      let weeds='';for(let i=0;i<7;i++){const x=20+r()*480;weeds+=`<path class="s sway" style="transform-origin:${n(x)}px 250px;animation-delay:${n(r()*3)}s" d="M${n(x)} 252q-10-24 0-44t0-40"/>`;}
      return `<path class="s wave" d="M-40 46q30-14 60 0t60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0"/><path class="s thin wave slow" d="M-40 66q30-12 60 0t60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0 60 0" opacity=".6"/><path class="f2" d="M0 252q90-26 180-10t180 0 160-8V260H0z"/>${weeds}${fish}${bubbles}`;
    },
    animals(r){
      let paws='';const base=150+r()*30;for(let i=0;i<8;i++){const x=40+i*58,y=base+(i%2?-18:18)+r()*8;paws+=`<g class="pop" style="animation-delay:${n(i*.35)}s" transform="translate(${n(x)} ${n(y)}) rotate(${n(70+r()*30)})"><ellipse class="f" cx="0" cy="6" rx="9" ry="7"/><circle class="f" cx="-9" cy="-6" r="3.4"/><circle class="f" cx="-3" cy="-11" r="3.4"/><circle class="f" cx="4" cy="-11" r="3.4"/><circle class="f" cx="10" cy="-6" r="3.4"/></g>`;}
      const sx=380+r()*100;
      return `<circle class="f2 s" cx="${n(sx)}" cy="58" r="26"/><path class="f2" d="M0 230q130-50 260-20t260-14V260H0z"/><path class="s thin" d="M0 230q130-50 260-20t260-14"/>${paws}<path class="s thin" d="M${n(60+r()*120)} 52q10-8 20 0q10-8 20 0M${n(150+r()*120)} 78q8-6 16 0q8-6 16 0"/>`;
    },
    plants(r){
      const x=250+r()*40;let leaves='';for(let i=0;i<5;i++){const y=210-i*34,side=i%2?1:-1;leaves+=`<path class="f2 s grow" style="animation-delay:${n(.4+i*.35)}s;transform-origin:${n(x)}px ${y}px" d="M${n(x)} ${y}q${side*30} -26 ${side*64} -10q${-side*28} 20 ${-side*64} 10z"/>`;}
      let sprouts='';for(let i=0;i<6;i++){const sx=20+r()*480;if(Math.abs(sx-x)<60)continue;sprouts+=`<path class="s thin" d="M${n(sx)} 236q-2-14 0-22M${n(sx)} 222q-10-8-14-2M${n(sx)} 220q10-8 14-2"/>`;}
      return `<g class="spin slow" style="transform-origin:70px 60px"><circle class="f2 s" cx="70" cy="60" r="20"/><path class="s thin" d="M70 22v10M70 88v10M32 60h10M98 60h10M43 33l7 7M90 80l7 7M43 87l7-7M90 40l7-7"/></g><path class="f2" d="M0 236h520v24H0z"/><path class="s draw" d="M${n(x)} 238C${n(x-8)} 180 ${n(x+10)} 120 ${n(x)} 50"/>${leaves}<circle class="f" cx="${n(x)}" cy="48" r="7"/>${sprouts}`;
    },
    history(r){
      const tx=60+r()*40;let cols='';for(let i=0;i<4;i++)cols+=`<rect class="f2 s" x="${n(tx+12+i*42)}" y="120" width="16" height="92"/>`;
      let stones='';for(let i=0;i<5;i++)stones+=`<rect class="f2" x="${n(300+r()*200)}" y="${n(222+r()*14)}" width="${n(10+r()*18)}" height="${n(6+r()*6)}"/>`;
      const px=330+r()*60;
      return `<circle class="f2 s glow" cx="${n(px+70)}" cy="62" r="22"/><path class="f2 s" d="M${n(px-70)} 214L${n(px)} 96l70 118z"/><path class="s thin" d="M${n(px)} 96l-24 118M${n(px-46)} 174h92M${n(px-24)} 136h48" opacity=".6"/><path class="f2 s" d="M${n(tx)} 120h184l-92-42z"/><rect class="f2 s" x="${n(tx-6)}" y="212" width="196" height="12"/>${cols}<path class="s thin" d="M0 236q120-14 260 0t260 0"/>${stones}`;
    },
    language(r){
      const glyphs=['Aa','ğ','ç','@','ş','Ω','あ','ü','ß','&','ı','Я','ñ','字'];
      let bubbles='';for(let i=0;i<4;i++){const x=24+i*124+r()*16,y=40+r()*120,w=86+r()*16,h=58;const g=glyphs[Math.floor(r()*glyphs.length)];bubbles+=`<g class="float" style="animation-delay:${n(i*.6)}s"><rect class="${i%2?'f2 ':''}s" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="14"/><path class="${i%2?'f2 ':''}s" d="M${n(x+22)} ${n(y+h)}l-6 18 22-18"/><text x="${n(x+w/2)}" y="${n(y+38)}">${esc(g)}</text></g>`;}
      return `${bubbles}<path class="s thin dash" d="M20 238H500" opacity=".5"/>`;
    },
    science(r){
      const cx=320+r()*60,cy=130;let orbits='';for(let i=0;i<3;i++)orbits+=`<g transform="rotate(${i*60} ${n(cx)} ${cy})"><ellipse class="s" cx="${n(cx)}" cy="${cy}" rx="92" ry="30"/><g class="spin" style="transform-origin:${n(cx)}px ${cy}px;animation-duration:${4+i*1.5}s"><circle class="f" cx="${n(cx+92)}" cy="${cy}" r="6" transform="rotate(${-i*60} ${n(cx+92)} ${cy})"/></g></g>`;
      let bub='';for(let i=0;i<6;i++)bub+=`<circle class="s thin rise" style="animation-delay:${n(r()*4)}s" cx="${n(88+r()*36)}" cy="${n(170+r()*40)}" r="${n(2+r()*4)}"/>`;
      return `${orbits}<circle class="f2 s" cx="${n(cx)}" cy="${cy}" r="16"/><path class="f2 s" d="M92 70h28M96 70v54l-36 86q-4 12 10 12h72q14 0 10-12l-36-86V70"/><path class="f2" d="M78 172h66l20 42q2 8-6 8H66q-8 0-6-8z"/>${bub}`;
    },
    body(r){
      const y=150+r()*20;
      return `<path class="s draw ecg" d="M0 ${n(y)}h120l14-30 18 74 20-96 18 52h70l12-14 12 14h236"/><path class="f2 s beat" style="transform-origin:110px 80px" d="M110 112c-40-26-50-56-30-70 12-8 24-2 30 10 6-12 18-18 30-10 20 14 10 44-30 70z"/><g class="float"><path class="s" d="M330 30c40 30-40 60 0 90s-40 60 0 90"/><path class="s" d="M370 30c-40 30 40 60 0 90s40 60 0 90"/><path class="s thin" d="M336 52h28M342 76h16M336 98h28M336 142h28M342 166h16M336 188h28"/></g>`;
    },
    geography(r){
      const cx=210+r()*40,cy=130;
      let peaks='';for(let i=0;i<3;i++){const x=360+i*48+r()*10,h=70+r()*60;peaks+=`<path class="f2 s" d="M${n(x-50)} 236L${n(x)} ${n(236-h)}l50 ${n(h)}z"/><path class="f" d="M${n(x-12)} ${n(236-h+18)}L${n(x)} ${n(236-h)}l12 18-6 4-6-6-6 6z"/>`;}
      return `<circle class="f2 s" cx="${n(cx)}" cy="${cy}" r="92"/><g class="globe"><ellipse class="s thin" cx="${n(cx)}" cy="${cy}" rx="36" ry="92"/><ellipse class="s thin" cx="${n(cx)}" cy="${cy}" rx="70" ry="92"/></g><path class="s thin" d="M${n(cx-92)} ${cy}h184M${n(cx-80)} ${cy-46}h160M${n(cx-80)} ${cy+46}h160"/><path class="s thin" d="M${n(cx)} 38v184"/><g class="bounce"><path class="f s" d="M${n(cx+30)} 98c-14 0-22-10-22-22 0-14 10-22 22-22s22 8 22 22c0 12-8 22-22 22z"/><path class="f" d="M${n(cx+22)} 94l8 22 8-22z"/><circle class="f2" cx="${n(cx+30)}" cy="76" r="7"/></g>${peaks}<path class="s thin" d="M300 236h220"/>`;
    },
    food(r){
      let beans='';for(let i=0;i<7;i++){const x=40+r()*180,y=212+r()*24;beans+=`<g transform="rotate(${n(r()*180)} ${n(x)} ${n(y)})"><ellipse class="f" cx="${n(x)}" cy="${n(y)}" rx="8" ry="5.5"/><path class="lightline" d="M${n(x-6)} ${n(y)}q6-3 12 0"/></g>`;}
      return `<ellipse class="f2 s" cx="320" cy="226" rx="128" ry="18"/><path class="f2 s" d="M240 120h160v42q0 54-80 54t-80-54z"/><path class="s" d="M400 136q38 0 34 30-4 24-38 24"/><path class="s steam" d="M282 104q-14-20 0-38t0-38"/><path class="s steam" style="animation-delay:.8s" d="M320 104q-14-20 0-38t0-38"/><path class="s steam" style="animation-delay:1.6s" d="M358 104q-14-20 0-38t0-38"/>${beans}`;
    },
    art(r){
      let notes='';const glyph=['♪','♫','♩','♬'];for(let i=0;i<5;i++)notes+=`<text class="float" style="animation-delay:${n(i*.5)}s" x="${n(330+r()*170)}" y="${n(40+r()*170)}">${glyph[i%4]}</text>`;
      const blobs=[0,1,2].map(()=>`<circle class="f2 s" cx="${n(80+r()*150)}" cy="${n(70+r()*110)}" r="${n(14+r()*26)}"/>`).join('');
      return `<rect class="s" x="46" y="34" width="220" height="168"/><rect class="s thin" x="56" y="44" width="200" height="148"/><path class="f2" d="M56 192l64-70 46 44 32-30 58 56z"/>${blobs}<path class="s" d="M156 202l-30 50M156 202l30 50M156 202v50"/>${notes}`;
    },
    tech(r){
      let traces='';for(let i=0;i<9;i++){const side=i%4,x=30+r()*460,y=24+r()*212;let d='';
        if(side===0)d=`M200 ${n(100+r()*60)}H${n(80+r()*60)}V${n(y)}H${n(20+r()*40)}`;else if(side===1)d=`M320 ${n(100+r()*60)}H${n(380+r()*60)}V${n(y)}H${n(470+r()*40)}`;else if(side===2)d=`M${n(220+r()*80)} 90V${n(30+r()*30)}H${n(x)}`;else d=`M${n(220+r()*80)} 170V${n(200+r()*30)}H${n(x)}`;
        traces+=`<path class="s thin" d="${d}"/><path class="s pulse" style="animation-delay:${n(r()*3)}s" d="${d}"/>`;}
      let pins='';for(let i=0;i<5;i++)pins+=`<path class="s thin" d="M${222+i*18} 90v-10M${222+i*18} 170v10M200 ${102+i*14}h-10M320 ${102+i*14}h10"/>`;
      return `${traces}${pins}<rect class="f2 s" x="200" y="90" width="120" height="80" rx="6"/><rect class="s thin" x="222" y="108" width="76" height="44"/><circle class="f tw" cx="260" cy="130" r="6"/>`;
    },
    math(r){
      let hex='';const hs=26;for(let row=0;row<6;row++)for(let col=0;col<6;col++){const x=300+col*hs*1.5,y=20+row*hs*1.73+(col%2?hs*.86:0);if(x>520||y>250)continue;const on=r()<.22;hex+=`<path class="${on?'f2 ':''}s thin" d="M${n(x+hs)} ${n(y)}l${n(-hs/2)} ${n(hs*.86)}h${-hs}l${n(-hs/2)} ${n(-hs*.86)}l${n(hs/2)} ${n(-hs*.86)}h${hs}z"/>`;}
      const syms=['π','∑','∞','√','φ','≈'];let floats='';for(let i=0;i<3;i++)floats+=`<text class="float" style="animation-delay:${n(i*.7)}s" x="${n(40+r()*200)}" y="${n(40+r()*60+i*60)}">${syms[Math.floor(r()*syms.length)]}</text>`;
      return `${hex}<path class="s draw" d="M170 150a8 8 0 0 1 8 8 16 16 0 0 1-16 16 24 24 0 0 1-24-24 40 40 0 0 1 40-40 64 64 0 0 1 64 64 104 104 0 0 1-104 104"/>${floats}`;
    },
    sports(r){
      // Koşu pisti, top ve bayrak: ortak spor sahnesi.
      let lanes='';for(let i=0;i<4;i++)lanes+=`<ellipse class="s thin" cx="260" cy="150" rx="${200-i*26}" ry="${92-i*18}"/>`;
      const bx=150+r()*220,by=200+r()*20;
      return `<path class="f2" d="M60 150a200 92 0 0 1 400 0a200 92 0 0 1-400 0zM164 150a96 38 0 0 0 192 0a96 38 0 0 0-192 0z" fill-rule="evenodd"/>${lanes}<path class="s thin dash" d="M260 58v184"/><g class="bounce"><circle class="f2 s" cx="${n(bx)}" cy="${n(by)}" r="20"/><path class="f" d="M${n(bx)} ${n(by-8)}l7.6 5.5-2.9 9h-9.4l-2.9-9z"/></g><path class="s" d="M420 40v70"/><path class="f s float" d="M420 40h46l-10 13 10 13h-46z"/>`;
    },
    textile(r){
      // Örme (süprem) ilmekleri: her ilmek iki eğik yapraktan oluşur.
      let knit='';const ox=250,oy=40;for(let row=0;row<7;row++)for(let col=0;col<9;col++){const x=ox+col*28,y=oy+row*28,on=r()<.18;knit+=`<g class="knit" style="animation-delay:${n((row*9+col)*.03)}s"><path class="s thin${on?' f2':''}" d="M${x} ${y}q-12 4-12 16 10 2 12-4zM${x} ${y}q12 4 12 16-10 2-12-4z"/></g>`;}
      return `<rect class="s thin" x="232" y="30" width="262" height="204"/>${knit}<circle class="f2 s" cx="110" cy="178" r="56"/><path class="s thin" d="M64 150q46 20 92-6M58 178q52 24 104-4M68 208q44 14 84-6M90 128q-6 50 26 104M130 126q20 50-6 106"/><path class="s" d="M40 60l130 92M60 40l130 92"/><circle class="f" cx="40" cy="60" r="5"/><circle class="f" cx="60" cy="40" r="5"/><path class="s draw" d="M160 168q40-10 50-60t40-60"/>`;
    }
  };

  function visual(item,lang){
    const cat=categoryFor(item.category),r=rng(seedOf(item.id));
    const scene=(scenes[cat.scene||cat.id]||scenes.space)(r);
    const label=lang==='en'?'Illustration':'Görsel';
    return `<figure class="blTriviaVisual" data-tone="${esc(cat.tone)}" data-category="${esc(cat.id)}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label+': '+pick(cat.label,lang))}" preserveAspectRatio="xMidYMid slice">${scene}</svg><span class="blTriviaIcon" aria-hidden="true">${esc(item.icon)}</span><figcaption><span>${esc(pick(cat.label,lang))}</span></figcaption></figure>`;
  }
  function render(item,lang='tr'){
    if(!item)return '';
    const cat=categoryFor(item.category);
    return `${visual(item,lang)}<div class="blGuideCopy blTriviaCopy" data-tone="${esc(cat.tone)}"><div class="blGuideEyebrow">${esc(pick(cat.label,lang))}</div><h2>${esc(pick(item.title,lang))}</h2><p>${esc(pick(item.text,lang))}</p></div>`;
  }

  // ── Arşiv paketleri ──
  // Çekirdek arşiv açılış perdesi için hemen hazırdır; büyük arşiv paketleri
  // arka planda, ayrıştırmayı bloklamadan yüklenir ve havuza katılır.
  const PACKS=Array.isArray(data.packs)?data.packs:[];
  let pendingPacks=0;
  const knownIds=new Set(data.items.map(i=>i.id));
  function addPack(pack){
    if(!pack||!Array.isArray(pack.rows))return 0;
    for(const c of pack.categories||[])if(c&&c.id&&!data.categories.some(x=>x.id===c.id))data.categories.push(c);
    let added=0;
    for(const row of pack.rows){
      if(!Array.isArray(row)||row.length<7)continue;
      const [id,category,icon,trTitle,trText,enTitle,enText]=row;
      if(!id||knownIds.has(id)||!data.categories.some(c=>c.id===category))continue;
      knownIds.add(id);data.items.push({id,category,icon,title:{tr:trTitle,en:enTitle},text:{tr:trText,en:enText}});added++;
    }
    return added;
  }
  function loadPacks(){
    const doc=global.document;if(!doc||!PACKS.length)return;
    const version=encodeURIComponent(String(global.BL_ASSET_VERSION||''));
    for(const file of PACKS){
      pendingPacks++;
      const script=doc.createElement('script');script.async=true;script.src=`${file}?v=${version}`;
      script.onload=script.onerror=()=>{pendingPacks=Math.max(0,pendingPacks-1);};
      (doc.head||doc.documentElement).appendChild(script);
    }
  }
  global.BLTriviaAddPack=addPack;
  for(const pack of global.BLTriviaPacks||[])addPack(pack);
  global.BLTriviaPacks={push:addPack};

  // ── "Her bilgi bir kez" seçimi ──
  // Görülen kimlikler cihazda tutulur (açılış perdesi kullanıcı bilinmeden çalışır).
  // Arşivin tamamı görülmeden hiçbir bilgi tekrar seçilmez; liste dolunca yeni tur başlar.
  // Henüz yüklenmemiş paketlerin kimlikleri silinmez. Depolama kapalıysa oturum belleği kullanılır.
  let memorySeen=[];
  function readSeen(){
    try{const raw=global.localStorage?.getItem(SEEN_KEY);if(raw!=null){const v=JSON.parse(raw);if(Array.isArray(v))return v.filter(x=>typeof x==='string');}}catch(_){}
    return memorySeen.slice();
  }
  function writeSeen(list){memorySeen=list.slice();try{global.localStorage?.setItem(SEEN_KEY,JSON.stringify(list));}catch(_){}}
  function markSeen(id){if(!knownIds.has(id))return;const seen=readSeen();if(seen.includes(id))return;seen.push(id);writeSeen(seen);}
  function nextUnseen(previousCategory,random=Math.random){
    let seen=readSeen(),seenSet=new Set(seen),unseen=data.items.filter(i=>!seenSet.has(i.id));
    if(!unseen.length){
      if(pendingPacks>0){
        // Paketler gelmeden çekirdek biterse turu sıfırlamadan en eski görüleni geçici olarak kullan.
        const oldest=seen.find(id=>knownIds.has(id));const item=data.items.find(i=>i.id===oldest)||data.items[0];
        writeSeen(seen.filter(id=>id!==item.id).concat(item.id));return item;
      }
      seen=[];seenSet=new Set();unseen=data.items.slice();
    }
    let pool=unseen.filter(i=>i.category!==previousCategory);if(!pool.length)pool=unseen;
    const item=pool[Math.floor(random()*pool.length)];
    seen.push(item.id);writeSeen(seen);
    return item;
  }

  // ── Kart bileşeni: açılış perdesi ve sayfa bekleme durumları aynı bileşeni kullanır ──
  // Kullanıcıya arşivin büyüklüğü veya kaç bilgi gördüğü gösterilmez.
  const currentLang=()=>{try{if(typeof appLang!=='undefined')return appLang==='en'?'en':'tr';}catch(_){}return global.document?.documentElement?.lang==='en'?'en':'tr';};
  const TICK=250;
  // Okuma süresi metin uzunluğuna göre: kısa bilgiler daha hızlı geçer.
  function readingMs(item,lang){const len=pick(item.text,lang).length+pick(item.title,lang).length;return Math.max(11000,Math.min(22000,7000+len*55));}
  function copyHtml(item,lang){
    const cat=categoryFor(item.category);
    return `<div class="blGuideEyebrow">${esc(pick(cat.label,lang))}</div><h2>${esc(pick(item.title,lang))}</h2><p>${esc(pick(item.text,lang))}</p>`;
  }
  function mount(host,options={}){
    if(!host)return null;
    const doc=host.ownerDocument||global.document,lang=options.lang||currentLang,tt=(tr,en)=>lang()==='en'?en:tr;
    const history=[];let index=-1,elapsed=0,paused=false,timer=null,destroyed=false,detached=0;
    host.classList.add('blTriviaHost');
    host.innerHTML=`<div class="blTriviaCard${options.compact?' blTriviaCard--compact':''}">${options.heading?`<div class="blTriviaHeading" data-trivia-heading></div>`:''}<div class="blTriviaFigure" data-trivia-visual></div><div class="blTriviaSide"><div class="blGuideCopy blTriviaCopy" data-trivia-copy></div><div class="blTriviaNav"><div class="blTriviaProgress" aria-hidden="true"><i data-trivia-progress></i></div><div class="blTriviaNavRow"><div class="blTriviaBtns"><button type="button" class="blTriviaBtn" data-trivia-prev>‹</button><button type="button" class="blTriviaBtn" data-trivia-pause aria-pressed="false">❚❚</button><button type="button" class="blTriviaBtn blTriviaBtn--next" data-trivia-next>›</button></div></div></div></div></div>`;
    const q=sel=>host.querySelector(sel),card=q('.blTriviaCard');
    function labels(){
      const set=(sel,label)=>{const b=q(sel);if(b){b.setAttribute('aria-label',label);b.title=label;}};
      set('[data-trivia-prev]',tt('Önceki bilgi','Previous fact'));set('[data-trivia-next]',tt('Sonraki bilgi','Next fact'));
      set('[data-trivia-pause]',paused?tt('Otomatik geçişi sürdür','Resume auto-advance'):tt('Otomatik geçişi duraklat','Pause auto-advance'));
      const pause=q('[data-trivia-pause]');if(pause){pause.textContent=paused?'▶':'❚❚';pause.setAttribute('aria-pressed',String(paused));}
      const head=q('[data-trivia-heading]');if(head)head.textContent=typeof options.heading==='function'?options.heading():tt('BEKLERKEN · BİLİYOR MUYDUNUZ?','WHILE YOU WAIT · DID YOU KNOW?');
      const prev=q('[data-trivia-prev]');if(prev)prev.disabled=index<=0;
    }
    function progress(){const bar=q('[data-trivia-progress]'),item=history[index];if(bar&&item)bar.style.transform=`scaleX(${Math.min(1,elapsed/readingMs(item,lang()))})`;}
    function paint(){
      const item=history[index];if(!item)return;
      const cat=categoryFor(item.category);card.dataset.tone=cat.tone;
      q('[data-trivia-visual]').innerHTML=visual(item,lang());
      q('[data-trivia-copy]').innerHTML=copyHtml(item,lang());
      labels();progress();options.onChange?.(item);
    }
    function next(){if(index<history.length-1)index++;else{history.push(nextUnseen(history[index]?.category));index=history.length-1;}elapsed=0;paint();}
    function prev(){if(index>0){index--;elapsed=0;paint();}}
    function toggle(){paused=!paused;labels();}
    function reading(){const active=doc.activeElement;return Boolean(card.matches?.(':hover')||(active&&active!==host&&host.contains(active)&&!active.matches?.('button')));}
    function tick(){
      if(destroyed)return;
      // Kart sayfadan sayfaya taşınırken kısa süre bağlantısız kalabilir.
      if(!host.isConnected){if(++detached>12)destroy();return;}
      detached=0;
      // Görünmeyen kart (başka sekme) ilerlemez; kimsenin görmediği bilgi harcanmaz.
      if(paused||doc.hidden||options.blocked?.()||reading()||(host.getClientRects&&!host.getClientRects().length))return;
      elapsed+=TICK;if(elapsed>=readingMs(history[index],lang()))next();else progress();
    }
    function destroy(){destroyed=true;if(timer)clearInterval(timer);timer=null;}
    q('[data-trivia-prev]').addEventListener('click',prev);
    q('[data-trivia-next]').addEventListener('click',next);
    q('[data-trivia-pause]').addEventListener('click',toggle);
    next();timer=setInterval(tick,TICK);
    return {next,prev,toggle,destroy,tick,refresh:paint,labels,current:()=>history[index],get paused(){return paused;},get destroyed(){return destroyed;}};
  }

  // ── Sayfa bekleme durumları ──
  // Ortak .uiState--loading kutusu yeterince genişse ve kısa sürede bitmemişse içine
  // bir bilgi kartı eklenir. Yükleme bitince kart bir anda kapanmaz: modülün üzerinde
  // "<Modül> hazır · <Modül> ekranına devam et" görünür. Dar/satır içi göstergeler,
  // diyaloglar ve açılış perdesi altındaki yüklemeler etkilenmez.
  const PAGE_DELAY=650,HOLD_MIN_MS=2500,END_SETTLE_MS=400,CHECK_MS=300;
  const EXCLUDED='#ovEmpty,dialog,[role="menu"],[role="listbox"],.uiFeedback,#blBootGuard,.blTriviaHold,[data-trivia="off"]';
  const watching=new Map(),tracked=new Set(),holds=new Map();let checkTimer=null;
  const doc=()=>global.document;
  const tl=(tr,en)=>currentLang()==='en'?en:tr;
  const bootActive=()=>Boolean(doc()?.getElementById?.('blBootGuard'));
  const visible=el=>Boolean(el&&el.isConnected&&el.getClientRects().length);
  const isLoading=el=>el.isConnected&&el.classList.contains('uiState--loading');
  function eligible(state){
    if(!isLoading(state)||state.closest(EXCLUDED)||bootActive())return false;
    const parent=state.parentElement;if(!parent)return false;
    return parent.getBoundingClientRect().width>=480&&visible(state);
  }
  const sectionOf=el=>el.closest?.('section[id^="view-"]')||null;
  function moduleLabel(section){
    const tab=String(section?.id||'').replace(/^view-/,'');
    const node=tab&&doc().querySelector(`.rail [data-tab="${tab}"] span`);
    return String(node?.textContent||'').trim();
  }
  function watch(state){if(state.dataset.blTrivia||watching.has(state))return;state.dataset.blTrivia='pending';watching.set(state,Date.now());schedule();}
  function schedule(){if(!checkTimer&&(watching.size||tracked.size||holds.size))checkTimer=setInterval(check,CHECK_MS);}
  function check(){
    const now=Date.now();
    for(const [state,since] of watching){
      if(!isLoading(state)){watching.delete(state);continue;}
      if(now-since<PAGE_DELAY||!eligible(state))continue;
      watching.delete(state);if(state.querySelector('.blTriviaPanel'))continue;
      const panel=doc().createElement('div');panel.className='blTriviaPanel';panel.setAttribute('role','group');panel.setAttribute('aria-live','off');
      panel.setAttribute('aria-label',tl('Biliyor muydunuz?','Did you know?'));
      state.dataset.blTrivia='on';state.classList.add('hasTrivia');state.appendChild(panel);
      const info={state,panel,section:sectionOf(state),shownAt:now,holding:false};
      info.ctl=mount(panel,{compact:true,heading:()=>info.holding?tl('BİLİYOR MUYDUNUZ?','DID YOU KNOW?'):tl('BEKLERKEN · BİLİYOR MUYDUNUZ?','WHILE YOU WAIT · DID YOU KNOW?')});
      tracked.add(info);
    }
    for(const info of [...tracked]){
      // Bitti: kutu değişti/kaldırıldı ya da modül görünürken kutu gizlendi.
      const finished=!isLoading(info.state)||(!visible(info.state)&&visible(info.section));
      if(finished){tracked.delete(info);setTimeout(()=>settle(info),END_SETTLE_MS);}
    }
    for(const hold of holds.values())hold.position();
    if(!watching.size&&!tracked.size&&!holds.size){clearInterval(checkTimer);checkTimer=null;}
  }
  function settle(info){
    // Çok aşamalı yüklemede kart bir sonraki bekleme kutusuna taşınır.
    const nextState=info.section&&[...info.section.querySelectorAll('.uiState--loading')].find(s=>eligible(s)&&!s.querySelector('.blTriviaPanel'));
    if(nextState){watching.delete(nextState);nextState.dataset.blTrivia='on';nextState.classList.add('hasTrivia');nextState.appendChild(info.panel);info.state=nextState;tracked.add(info);schedule();return;}
    if(Date.now()-info.shownAt<HOLD_MIN_MS||!visible(info.section)||holds.has(info.section)||bootActive()){info.ctl.destroy();info.panel.remove();return;}
    showHold(info);
  }
  function showHold(info){
    const section=info.section,label=moduleLabel(section)||tl('Ekran','Screen');
    info.holding=true;
    const hold=doc().createElement('div');hold.className='blTriviaHold';hold.setAttribute('role','dialog');hold.setAttribute('aria-modal','false');
    hold.setAttribute('aria-label',tl(`${label} hazır`,`${label} is ready`));
    hold.innerHTML=`<div class="blTriviaHoldCard"><div class="blTriviaHoldHead"><span class="blTriviaHoldReady">${esc(tl(`${label} hazır`,`${label} is ready`))}</span><span class="blTriviaHoldHint">${esc(tl('Okumanızı bitirdiğinizde devam edebilirsiniz.','Continue whenever you have finished reading.'))}</span></div><div data-hold-slot></div><div class="blTriviaHoldFoot"><button type="button" class="blTriviaHoldContinue" data-hold-continue>${esc(tl(`${label} ekranına devam et`,`Continue to ${label}`))} →</button></div></div>`;
    hold.querySelector('[data-hold-slot]').appendChild(info.panel);info.ctl.labels();
    doc().body.appendChild(hold);
    let closed=false;
    const entry={position(){
      if(closed)return;
      if(!section.isConnected){close(true);return;}
      const r=section.getBoundingClientRect(),vw=global.innerWidth||0,vh=global.innerHeight||0;
      const top=Math.max(r.top,0),left=Math.max(r.left,0),bottom=Math.min(r.bottom,vh),right=Math.min(r.right,vw);
      // Modül sekmesi görünmüyorsa (başka sekme açık) beklet; geri dönünce yine gösterilir.
      if(!visible(section)||bottom-top<80||right-left<200){hold.hidden=true;return;}
      hold.hidden=false;hold.style.top=top+'px';hold.style.left=left+'px';hold.style.width=(right-left)+'px';hold.style.height=(bottom-top)+'px';
    }};
    function close(immediate){
      if(closed)return;closed=true;holds.delete(section);info.ctl.destroy();
      global.removeEventListener?.('resize',entry.position);global.removeEventListener?.('scroll',entry.position,true);
      let reduce=false;try{reduce=global.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_){}
      hold.dataset.leaving='1';setTimeout(()=>hold.remove(),immediate||reduce?0:300);
    }
    entry.close=close;holds.set(section,entry);
    hold.querySelector('[data-hold-continue]').addEventListener('click',()=>close(false));
    hold.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.stopPropagation();close(false);}});
    global.addEventListener?.('resize',entry.position);global.addEventListener?.('scroll',entry.position,true);
    entry.position();schedule();
  }
  function scan(node){
    if(!node||node.nodeType!==1)return;
    if(node.matches('.uiState--loading'))watch(node);
    node.querySelectorAll?.('.uiState--loading').forEach(watch);
  }
  function watchLoadingStates(){
    const d=doc();if(!d?.body||typeof global.MutationObserver!=='function')return null;
    scan(d.body);
    const observer=new global.MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)scan(n);});
    observer.observe(d.body,{childList:true,subtree:true});
    return observer;
  }
  if(global.document){
    loadPacks();
    if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',watchLoadingStates,{once:true});else watchLoadingStates();
  }

  global.BLTrivia={data,render,visual,mount,nextUnseen,markSeen,readSeen,addPack,watchLoadingStates,check,
    get pendingPacks(){return pendingPacks;},_holds:holds};
})(window);
