/* Buyer Log Motion+ · seçilebilir tema geçişleri (DESIGN_SYSTEM.md §6).
   BLMotionPlus.theme() kullanıcı tetiklediği tema değişiminde önce buraya sorar.
   Toz ve üçgen efektleri eski temanın tek karesini (masaüstü köprüsü
   buyerlog:capture-view) tek bir canvas katmanında parçalara ayırır; yeni tema
   altta gerçek DOM'dur. Kare yalnız bellekte ve yalnız geçiş boyunca yaşar.
   Taneli çözülme View Transitions ile çalışır, yakalama gerektirmez. Yakalama
   yoksa (tarayıcı kipi) veya başarısızsa daireye / anlık geçişe düşülür.
   Her geçiş sonludur; yeni istek eskisini anında bitirir. */
(function(root){
  'use strict';
  const doc=root.document;if(!doc)return;
  const html=doc.documentElement;
  // Tema gibi kişisel tercihtir: BLStorage kullanıcıya ayırır ve hesapla taşır.
  const KEY='lcw.themeTransition.v1';
  const store=()=>root.BLStorage||root.localStorage;
  const EFFECTS=Object.freeze([
    {id:'chain',capture:true,tri:true,tr:'Sırayla katlanan üçgenler',en:'Triangles folding in sequence'},
    {id:'fold',capture:true,tri:true,tr:'Kenardan katlanan üçgenler',en:'Triangles folding at the edge'},
    {id:'spin',capture:true,tri:true,tr:'Yerinde dönen üçgenler',en:'Triangles flipping in place'},
    {id:'blow',capture:true,tr:'Düğmeden üflenen toz',en:'Dust blown from the button'},
    {id:'wind',capture:true,tr:'Rüzgârda savrulan toz',en:'Dust carried by the wind'},
    {id:'mask',capture:false,tr:'Taneli çözülme',en:'Grainy dissolve'},
    {id:'circle',capture:false,tr:'Daire',en:'Circle'}
  ]);
  // Hız 1 (yavaş) … 5 (en hızlı): efektin temel süresi.
  const SPEEDS=Object.freeze([1600,1300,1000,750,500]);
  const SIZE_MIN=40,SIZE_MAX=100,SIZE_STEP=10;
  const DEFAULTS=Object.freeze({effect:'chain',speed:5,size:70});
  const effectById=id=>EFFECTS.find(e=>e.id===id)||null;
  function normalize(value){
    const v=value&&typeof value==='object'?value:{};
    const speed=Math.round(Number(v.speed)),size=Math.round(Number(v.size)/SIZE_STEP)*SIZE_STEP;
    return{
      effect:effectById(v.effect)?v.effect:DEFAULTS.effect,
      speed:speed>=1&&speed<=SPEEDS.length?speed:DEFAULTS.speed,
      size:size>=SIZE_MIN&&size<=SIZE_MAX?size:DEFAULTS.size
    };
  }
  function settings(){try{return normalize(JSON.parse(store().getItem(KEY)||'{}'));}catch(_){return normalize(null);}}
  function save(next){
    const value=normalize(Object.assign(settings(),next||{}));
    try{store().setItem(KEY,JSON.stringify(value));}catch(_){}
    return value;
  }

  /* ---- ortak yardımcılar ---- */
  function seeded(seed){let s=seed%2147483647||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}
  const lattice=(()=>{const r=seeded(7),g=new Float32Array(4096);for(let i=0;i<g.length;i++)g[i]=r();return g;})();
  function noise(x,y){
    const at=(i,j)=>lattice[((j&63)<<6)|(i&63)];
    const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
    const a=at(xi,yi)+(at(xi+1,yi)-at(xi,yi))*u,b=at(xi,yi+1)+(at(xi+1,yi+1)-at(xi,yi+1))*u;
    return a+(b-a)*v;
  }
  function originPoint(origin,w,h){
    const box=origin&&typeof origin.getBoundingClientRect==='function'&&origin.isConnected!==false?origin.getBoundingClientRect():null;
    return box&&box.width>0&&box.height>0?{x:box.left+box.width/2,y:box.top+box.height/2}:{x:w/2,y:h/2};
  }
  function makeLayer(w,h){
    const canvas=doc.createElement('canvas');
    canvas.className='blThemeFxLayer';canvas.setAttribute('aria-hidden','true');
    canvas.width=w;canvas.height=h;
    doc.body.appendChild(canvas);
    return canvas;
  }
  // Ana süreçten gelen BGRA kare → RGBA canvas. Boyut tutmazsa kare reddedilir.
  function frameFromShot(shot,w,h){
    const bgra=shot&&shot.bgra;
    if(!bgra||shot.width!==w||shot.height!==h||bgra.length!==w*h*4)return null;
    const canvas=doc.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d'),img=ctx.createImageData(w,h),d=img.data;
    for(let i=0;i<d.length;i+=4){d[i]=bgra[i+2];d[i+1]=bgra[i+1];d[i+2]=bgra[i];d[i+3]=255;}
    ctx.putImageData(img,0,0);
    return{canvas,data:d,width:w,height:h};
  }
  function loop(step,limitMs){
    let raf=0,done=false;const start=performance.now();
    const handle={stop(){if(done)return;done=true;root.cancelAnimationFrame(raf);handle.onstop?.();},onstop:null};
    const tick=now=>{
      if(done)return;
      if(now-start>limitMs||step((now-start)/1000)===false){handle.stop();return;}
      raf=root.requestAnimationFrame(tick);
    };
    raf=root.requestAnimationFrame(tick);
    return handle;
  }

  /* ---- toz: eski kare 2–4 px bloklara bölünüp savrulur ---- */
  function dust(frame,layer,kind,o,D){
    const W=frame.width,H=frame.height,src=frame.data,ctx=layer.getContext('2d');
    const b=W*H>1500000?4:W*H>620000?3:2,nx=Math.ceil(W/b),ny=Math.ceil(H/b),N=nx*ny;
    const ox=new Float32Array(N),oy=new Float32Array(N),st=new Float32Array(N),vx=new Float32Array(N),vy=new Float32Array(N);
    const ax=new Float32Array(N),ay=new Float32Array(N),wx=new Float32Array(N),wy=new Float32Array(N),life=new Float32Array(N),ph=new Float32Array(N),col=new Uint32Array(N);
    const R=Math.hypot(Math.max(o.x,W-o.x),Math.max(o.y,H-o.y));let n=0;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const x=i*b,y=j*b,si=(Math.min(H-1,y+1)*W+Math.min(W-1,x+1))*4;
      ox[n]=x;oy[n]=y;col[n]=(255<<24|src[si+2]<<16|src[si+1]<<8|src[si])>>>0;
      if(kind==='blow'){
        // Cephe düğmeden dışa yayılır; açıya bağlı gürültü kenarı dalgalandırır.
        const dx=x-o.x,dy=y-o.y,r=Math.hypot(dx,dy)||1,ux=dx/r,uy=dy/r,th=Math.atan2(dy,dx);
        const wob=noise(Math.cos(th)*2.2+9,Math.sin(th)*2.2+9)-.5;
        st[n]=Math.max(0,(r/R)*D*.68+wob*D*.3+(noise(x*.03,y*.03)-.5)*D*.1+Math.random()*D*.08);
        const a=th+(Math.random()-.5)*.7+.25,sp=120+Math.random()*320,amp=3+Math.random()*7;
        vx[n]=Math.cos(a)*sp;vy[n]=Math.sin(a)*sp;ax[n]=ux*260-uy*60;ay[n]=uy*260+ux*60;wx[n]=-uy*amp;wy[n]=ux*amp;
      }else{
        st[n]=(x/W)*D*.62+(noise(x*.02,y*.02)-.5)*D*.18+Math.random()*D*.12;
        vx[n]=90+Math.random()*260;vy[n]=-55+Math.random()*70;ax[n]=110;ay[n]=0;wx[n]=0;wy[n]=7;
      }
      life[n]=.4+Math.random()*.5;ph[n]=Math.random()*6.283;n++;
    }
    const buf=new Uint32Array(W*H),img=new ImageData(new Uint8ClampedArray(buf.buffer),W,H);
    return loop(t=>{
      buf.fill(0);let alive=0;
      for(let p=0;p<n;p++){
        let x=ox[p],y=oy[p],a=255;
        if(t>st[p]){
          const d=t-st[p];if(d>=life[p])continue;
          const w=Math.sin(d*8+ph[p]);x+=vx[p]*d+ax[p]*d*d+wx[p]*w;y+=vy[p]*d+ay[p]*d*d+wy[p]*w;a=255*(1-d/life[p]);
        }
        alive++;
        const ix=x|0,iy=y|0;if(ix<0||iy<0||ix+b>W||iy+b>H)continue;
        const c=((col[p]&0x00ffffff)|((a|0)<<24))>>>0;
        for(let yy=0;yy<b;yy++){const row=(iy+yy)*W+ix;for(let xx=0;xx<b;xx++)buf[row+xx]=c;}
      }
      ctx.putImageData(img,0,0);
      return alive>0;
    },D*1000+2500);
  }

  /* ---- üçgenler: ekran üçgen ağına bölünür, dalga düğmeden yayılır ---- */
  // Satır satır, sağdan sola zincir: ardışık iki üçgen daima bir kenarı paylaşır.
  function mesh(W,H,s){
    const cols=Math.ceil(W/s)+1,rows=Math.ceil(H/s)+1,r=seeded(17),P=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const edge=i===0||j===0||i===cols||j===rows;
      P.push([Math.min(W,i*s)+(edge?0:(r()-.5)*s*.36),Math.min(H,j*s)+(edge?0:(r()-.5)*s*.36)]);
    }
    const at=(i,j)=>P[j*(cols+1)+i],chains=[];
    const inside=t=>Math.min(t[0][0],t[1][0],t[2][0])<W&&Math.min(t[0][1],t[1][1],t[2][1])<H;
    for(let j=0;j<rows;j++){
      const chain=[];
      for(let i=cols-1;i>=0;i--){
        const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);
        for(const t of (i+j)%2?[[a,b,c],[a,c,d]]:[[b,c,d],[a,b,d]])if(inside(t))chain.push(t);
      }
      if(chain.length)chains.push(chain);
    }
    return chains;
  }
  // Kenar yumuşatması komşu üçgenler arasında iz bırakmasın diye silme/dolgu biraz taşar.
  function triPath(ctx,t,grow){
    const cx=(t[0][0]+t[1][0]+t[2][0])/3,cy=(t[0][1]+t[1][1]+t[2][1])/3;ctx.beginPath();
    for(let k=0;k<3;k++){
      let x=t[k][0],y=t[k][1];
      if(grow){const dx=x-cx,dy=y-cy,l=Math.hypot(dx,dy)||1;x+=dx/l*grow;y+=dy/l*grow;}
      if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    }
    ctx.closePath();
  }
  function hinge(t,o,next){
    let edge=null;
    if(next){const shared=t.filter(p=>next.includes(p));if(shared.length===2)edge=shared;}
    if(!edge){let best=Infinity;for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],d=Math.hypot((a[0]+b[0])/2-o.x,(a[1]+b[1])/2-o.y);if(d<best){best=d;edge=[a,b];}}}
    const [a,b]=edge,cx=(t[0][0]+t[1][0]+t[2][0])/3,cy=(t[0][1]+t[1][1]+t[2][1])/3,mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
    let nx=-(b[1]-a[1]),ny=b[0]-a[0];if(nx*(cx-mx)+ny*(cy-my)<0){nx=-nx;ny=-ny;}
    return{hx:mx,hy:my,phi:Math.atan2(ny,nx)};
  }
  function triangles(frame,layer,kind,o,D,size,paper){
    const W=frame.width,H=frame.height,ctx=layer.getContext('2d'),old=frame.canvas;
    const rest=doc.createElement('canvas');rest.width=W;rest.height=H;
    const rc=rest.getContext('2d');rc.drawImage(old,0,0);rc.globalCompositeOperation='destination-out';
    const R=Math.hypot(Math.max(o.x,W-o.x),Math.max(o.y,H-o.y)),chains=mesh(W,H,size),tris=[];
    const centroid=t=>[(t[0][0]+t[1][0]+t[2][0])/3,(t[0][1]+t[1][1]+t[2][1])/3];
    let flip=Math.max(.32,D*.5);
    if(kind==='chain'){
      // Her üçgen öncekinin katlanmasını bekler, sonra yığınla birlikte sıradakinin
      // üstüne katlanır. Geniş ekranda süre uzamasın diye satırlar 16 üçgenlik
      // zincirlere bölünür; zincirler düğmeye uzaklıklarına göre kademeli başlar.
      const SEG=16;flip=Math.max(.045,D*.12);
      for(const row of chains)for(let s=0;s<row.length;s+=SEG){
        const seg=row.slice(s,s+SEG),c=centroid(seg[0]),lag=Math.hypot(c[0]-o.x,c[1]-o.y)/R*D*.6;
        let prev=null;
        seg.forEach((t,k)=>{const q=Object.assign({t,st:lag+k*flip,last:k===seg.length-1,prev},hinge(t,o,seg[k+1]));tris.push(q);prev=q;});
      }
    }else{
      for(const row of chains)for(const t of row){
        const c=centroid(t),dist=Math.hypot(c[0]-o.x,c[1]-o.y),th=Math.atan2(c[1]-o.y,c[0]-o.x);
        const wob=noise(Math.cos(th)*2+4,Math.sin(th)*2+4)-.5;
        tris.push(Object.assign({t,st:Math.max(0,dist/R*D*.7+wob*D*.22+Math.random()*D*.07),last:true,prev:null},kind==='fold'?hinge(t,o,null):{hx:c[0],hy:c[1],phi:th}));
      }
    }
    for(const q of tris){
      const xs=q.t.map(p=>p[0]),ys=q.t.map(p=>p[1]);
      q.bx=Math.max(0,Math.floor(Math.min(...xs))-1);q.by=Math.max(0,Math.floor(Math.min(...ys))-1);
      q.bw=Math.min(W,Math.ceil(Math.max(...xs))+1)-q.bx;q.bh=Math.min(H,Math.ceil(Math.max(...ys))+1)-q.by;q.on=false;
    }
    tris.sort((a,b)=>a.st-b.st);
    const smooth=k=>k*k*(3-2*k),hinged=kind!=='spin';
    return loop(t=>{
      let left=0;
      for(const q of tris)if(!q.on&&t>=q.st){q.on=true;triPath(rc,q.t,1);rc.fill();}
      ctx.clearRect(0,0,W,H);ctx.drawImage(rest,0,0);
      // Önceki üçgeni üstüne almış, sırası henüz gelmemiş üçgenler kâğıt arkasını gösterir.
      for(const q of tris){
        if(t>=q.st||!q.prev||t<q.prev.st+flip)continue;
        ctx.save();ctx.fillStyle=paper;triPath(ctx,q.t,.6);ctx.fill();ctx.globalAlpha=.12;ctx.fillStyle='#000';ctx.fill();ctx.restore();
      }
      for(const q of tris){
        if(t<q.st){left++;continue;}
        const k=(t-q.st)/flip;if(k>=1)continue;left++;
        const a=(kind==='chain'?k:smooth(k))*Math.PI,c=Math.cos(a),back=c<0;
        const fade=q.last&&hinged&&back?Math.min(1,(1-k)*2.2):1,lift=1+Math.sin(a)*(hinged?.04:.12);
        ctx.save();ctx.globalAlpha=fade;
        ctx.translate(q.hx,q.hy);ctx.rotate(q.phi);ctx.scale(hinged?c:Math.abs(c),lift);ctx.rotate(-q.phi);ctx.translate(-q.hx,-q.hy);
        triPath(ctx,q.t,.6);ctx.clip();
        if(hinged&&(back||q.prev)){ctx.fillStyle=paper;ctx.fillRect(q.bx,q.by,q.bw,q.bh);}
        // Yerinde dönmede arka yarıda altta zaten yeni tema görünür; yalnız gölge çizilir.
        else if(!back&&q.bw>0&&q.bh>0)ctx.drawImage(old,q.bx,q.by,q.bw,q.bh,q.bx,q.by,q.bw,q.bh);
        ctx.globalAlpha=fade*(1-Math.abs(c))*.38;ctx.fillStyle=back?'#fff':'#000';ctx.fillRect(q.bx,q.by,q.bw,q.bh);
        ctx.restore();
      }
      return left>0;
    },kind==='chain'?D*1000+20*flip*1000+2500:D*1000+flip*1000+2500);
  }

  /* ---- taneli çözülme: View Transitions eski karesine kayan taneli maske ---- */
  let maskCache=null;
  function grainMask(W,H){
    if(maskCache&&maskCache.W===W&&maskCache.H===H)return maskCache;
    const cell=2,Z=Math.round(W*.5),zc=Math.ceil(Z/cell),cols=zc+Math.ceil(W/cell),rows=Math.ceil(H/cell),r=seeded(99);
    const canvas=doc.createElement('canvas');canvas.width=cols*cell;canvas.height=rows*cell;
    const g=canvas.getContext('2d');g.fillStyle='#000';g.fillRect(zc*cell,0,canvas.width,canvas.height);
    for(let i=0;i<zc;i++){const f=i/zc;for(let j=0;j<rows;j++)if(f+(noise(i*.05,j*.05)-.5)*.5+(r()-.5)*.35>.5)g.fillRect(i*cell,j*cell,cell,cell);}
    maskCache={W,H,Z:zc*cell,url:canvas.toDataURL('image/png'),w:canvas.width,h:canvas.height};
    return maskCache;
  }
  // Tozu renklendirmek için eski temanın renkleri kaba bir ızgaradan okunur (piksel değil).
  function sampleColors(W,H){
    const gx=24,gy=14,out=[];
    const solid=c=>c&&c!=='transparent'&&!/,\s*0\)$/.test(c);
    for(let i=0;i<gx;i++){out.push([]);for(let j=0;j<gy;j++){
      const el=doc.elementFromPoint((i+.5)*W/gx,(j+.5)*H/gy);let bg=null,fg=null,e=el;
      if(el)fg=root.getComputedStyle(el).color;
      while(e&&e!==html){const c=root.getComputedStyle(e).backgroundColor;if(solid(c)){bg=c;break;}e=e.parentElement;}
      out[i].push({bg:bg||root.getComputedStyle(doc.body).backgroundColor,fg:fg||bg});
    }}
    return(x,y)=>{const c=out[Math.max(0,Math.min(gx-1,(x/W*gx)|0))][Math.max(0,Math.min(gy-1,(y/H*gy)|0))];return Math.random()<.35?c.fg:c.bg;};
  }
  function grain(update,D){
    if(typeof doc.startViewTransition!=='function')return null;
    const W=root.innerWidth||0,H=root.innerHeight||0;if(!W||!H)return null;
    const m=grainMask(W,H),colorAt=sampleColors(W,H),layer=makeLayer(W,H),ctx=layer.getContext('2d');
    html.classList.add('blThemeFxMask');
    const cleanup=()=>html.classList.remove('blThemeFxMask');
    let transition;
    try{transition=doc.startViewTransition(update);}catch(_){cleanup();layer.remove();return null;}
    const travel=D*.9,P=[],rate=15000*(H/540);let spawn=0,last=0;
    transition.ready.then(()=>{
      const image='url("'+m.url+'")',size=m.w+'px '+m.h+'px';
      html.animate({maskImage:[image,image],maskSize:[size,size],maskPosition:[(-m.Z)+'px 0',W+'px 0']},{duration:travel*1000,easing:'linear',pseudoElement:'::view-transition-old(root)',fill:'forwards'});
    }).catch(()=>{});
    transition.finished.catch(()=>{}).then(cleanup);
    const handle=loop(t=>{
      const dt=Math.min(.05,t-last);last=t;
      const k=Math.min(1,t/travel),mx=-m.Z+(W+m.Z)*k;
      if(k<1){
        spawn+=rate*dt*(.5+.8*Math.sin(Math.PI*k));
        for(;spawn>=1;spawn--){
          const x=mx+m.Z*(.05+Math.random()*.6);if(x<0||x>W)continue;
          const y=Math.random()*H;
          P.push({x,y,vx:25+Math.random()*120,vy:-30+Math.random()*38,age:0,life:.7+Math.random()*.8,s:1.5+Math.random()*2.5,ph:Math.random()*6.283,c:colorAt(x,y)});
        }
      }
      ctx.clearRect(0,0,W,H);
      for(let i=P.length-1;i>=0;i--){
        const p=P[i];p.age+=dt;
        if(p.age>=p.life){P[i]=P[P.length-1];P.pop();continue;}
        p.vx+=240*dt;p.x+=p.vx*dt;p.y+=p.vy*dt+Math.sin(p.age*7+p.ph)*28*dt;
        ctx.globalAlpha=1-p.age/p.life;ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,p.s,p.s);
      }
      return k<1||P.length>0;
    },D*1000+3000);
    handle.onstop=()=>{layer.remove();try{transition.skipTransition?.();}catch(_){}};
    return handle;
  }

  /* ---- giriş noktası: BLMotionPlus.theme() çağırır ---- */
  let active=null,token=0;
  function finishActive(){const a=active;active=null;if(a)a.stop();}
  function track(handle,layer){
    if(!handle){layer?.remove();return;}
    const prior=handle.onstop;
    handle.onstop=()=>{prior?.();layer?.remove();if(active===handle)active=null;};
    active=handle;
  }
  // true: geçişi bu modül üstlendi (update kendisi çağırır). false: çağıran daireyi/anlık yolu kullanır.
  function run(update,origin){
    const pref=settings(),fx=effectById(pref.effect),D=SPEEDS[pref.speed-1]/1000;
    if(typeof update!=='function'||!fx||fx.id==='circle')return false;
    finishActive();const mine=++token;
    if(!fx.capture){const handle=grain(update,D);if(!handle)return false;track(handle,null);return true;}
    const capture=root.buyerLogDesktop?.captureView;
    if(typeof capture!=='function')return false;
    const W=Math.round(root.innerWidth||0),H=Math.round(root.innerHeight||0);
    if(!W||!H)return false;
    const o=originPoint(origin,W,H);
    const paper=root.getComputedStyle(html).getPropertyValue('--ui-surface-strong').trim()||'#888';
    Promise.resolve().then(()=>capture(W,H)).then(shot=>{
      if(mine!==token){update();return;}
      const frame=frameFromShot(shot,W,H);
      if(!frame){update();return;}
      // Eski kare ekranı örterken tema altta değişir; aynı karede çizildiği için yanıp sönmez.
      const layer=makeLayer(W,H);layer.getContext('2d').drawImage(frame.canvas,0,0);
      update();
      track(fx.tri?triangles(frame,layer,fx.id,o,D,pref.size,paper):dust(frame,layer,fx.id,o,D),layer);
    }).catch(()=>update());
    return true;
  }

  /* ---- Görünüm menüsü: efekt, hız ve üçgen boyutu ---- */
  const isEn=()=>html.lang==='en';
  function syncControls(){
    const select=doc.getElementById('themeFxEffect'),speed=doc.getElementById('themeFxSpeed'),size=doc.getElementById('themeFxSize');
    if(!select||!speed||!size)return;
    const pref=settings(),fx=effectById(pref.effect);
    select.replaceChildren(...EFFECTS.map(e=>{const o=doc.createElement('option');o.value=e.id;o.textContent=isEn()?e.en:e.tr;return o;}));
    select.value=pref.effect;speed.value=String(pref.speed);size.value=String(pref.size);
    size.disabled=!fx.tri;
    const speedOut=doc.getElementById('themeFxSpeedValue'),sizeOut=doc.getElementById('themeFxSizeValue'),note=doc.getElementById('themeFxNote');
    if(speedOut)speedOut.textContent=pref.speed===SPEEDS.length?(isEn()?'Fastest':'En hızlı'):pref.speed===1?(isEn()?'Slowest':'En yavaş'):pref.speed+'/'+SPEEDS.length;
    if(sizeOut)sizeOut.textContent=pref.size+' px';
    if(note)note.hidden=!(fx.capture&&typeof root.buyerLogDesktop?.captureView!=='function');
  }
  function mount(){
    const select=doc.getElementById('themeFxEffect'),speed=doc.getElementById('themeFxSpeed'),size=doc.getElementById('themeFxSize');
    if(!select||!speed||!size)return;
    select.addEventListener('change',()=>{save({effect:select.value});syncControls();});
    speed.addEventListener('input',()=>{save({speed:Number(speed.value)});syncControls();});
    size.addEventListener('input',()=>{save({size:Number(size.value)});syncControls();});
    doc.addEventListener('bl:language-changed',syncControls);
    syncControls();
  }
  root.BLMotionPlusTheme=Object.freeze({EFFECTS,SPEEDS,DEFAULTS,settings,save,run,finish:finishActive});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:globalThis);
