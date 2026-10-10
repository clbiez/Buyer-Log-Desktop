(function(root){
  'use strict';
  const W=760,H=500,TW=30,TH=15,OX=338,OY=157;
  const iso=(x,y)=>({x:OX+(x-y)*TW,y:OY+(x+y)*TH});
  const uniso=(x,y)=>({x:Math.round(((x-OX)/TW+(y-OY)/TH)/2),y:Math.round(((y-OY)/TH-(x-OX)/TW)/2)});
  const PERIODS={morning:{sky:'#cbdde6',wall:'#e8e1d5',floor:'#d8b789',light:'#fff2d2'},noon:{sky:'#dcebf0',wall:'#f0e9dc',floor:'#e0bf90',light:'#fff7de'},evening:{sky:'#283e59',wall:'#aba298',floor:'#ae8761',light:'#edc888'}};
  const CLOTHES={blue:'#3f6488',cream:'#e9dfce',green:'#536f65',ink:'#303b47',rust:'#9b6552'};
  const SKIN=['#f0d4bd','#ddb396','#be9276','#996f55','#704f3b'];
  const block=(kind)=>!['rug','lamp'].includes(kind);
  function pathBetween(start,end,occupied){
    const key=(x,y)=>`${x},${y}`,queue=[{x:Math.round(start.x),y:Math.round(start.y),path:[]}],seen=new Set([key(Math.round(start.x),Math.round(start.y))]);
    for(let i=0;i<queue.length&&i<96;i++){
      const current=queue[i];
      if(current.x===end.x&&current.y===end.y)return current.path;
      for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const x=current.x+dx,y=current.y+dy;if(x<0||x>11||y<0||y>7||occupied.has(key(x,y))||seen.has(key(x,y)))continue;seen.add(key(x,y));queue.push({x,y,path:current.path.concat({x,y})});}
    }
    return [];
  }
  function create(canvas,hooks={}){
    const ctx=canvas.getContext('2d'),background=document.createElement('canvas');background.width=W;background.height=H;canvas.width=W;canvas.height=H;
    const bg=background.getContext('2d');ctx.imageSmoothingEnabled=false;bg.imageSmoothingEnabled=false;
    let data={profiles:[],office:{period:'auto',furniture:[]}},selected='',editing=false,motion=null,active=false,frame=0,last=0,period='',drag=null,dirty=true;
    const actors=new Map(),reduced=root.matchMedia('(prefers-reduced-motion: reduce)');
    function currentPeriod(){const mode=data.office.period;if(mode&&mode!=='auto')return mode;const hour=new Date().getHours();return hour>=6&&hour<11?'morning':hour>=11&&hour<18?'noon':'evening';}
    function polygon(c,points,color){c.fillStyle=color;c.beginPath();points.forEach((p,index)=>index?c.lineTo(Math.round(p.x),Math.round(p.y)):c.moveTo(Math.round(p.x),Math.round(p.y)));c.closePath();c.fill();}
    function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
    function tile(c,x,y,color){const p=iso(x,y);polygon(c,[{x:p.x,y:p.y-TH},{x:p.x+TW,y:p.y},{x:p.x,y:p.y+TH},{x:p.x-TW,y:p.y}],color);}
    function cube(c,x,y,width,depth,height,top,left,right){const p=iso(x,y),a={x:p.x,y:p.y-height},b={x:p.x+width*TW,y:p.y+width*TH-height},d={x:p.x-depth*TW,y:p.y+depth*TH-height},e={x:p.x+(width-depth)*TW,y:p.y+(width+depth)*TH-height};
      polygon(c,[d,e,{x:e.x,y:e.y+height},{x:d.x,y:d.y+height}],left);polygon(c,[b,e,{x:e.x,y:e.y+height},{x:b.x,y:b.y+height}],right);polygon(c,[a,b,e,d],top);
    }
    function floor(){
      const colors=PERIODS[period];bg.clearRect(0,0,W,H);rect(bg,0,0,W,H,period==='evening'?'#38424e':'#e4e8e9');
      polygon(bg,[{x:72,y:167},{x:338,y:33},{x:697,y:211},{x:697,y:324},{x:338,y:145},{x:72,y:280}],colors.wall);
      // Tall loft windows; the outside sky, glass and lamps change with local time.
      for(let i=0;i<4;i++){const x=365+i*74,y=55+i*37;polygon(bg,[{x,y},{x:x+62,y:y+31},{x:x+62,y:y+111},{x,y:y+80}],colors.sky);
        for(let j=0;j<4;j++){const bx=x+5+j*13;rect(bg,bx,y+48+j*6,9,25+(j%2)*16,period==='evening'?'#536478':'#b9c6d0');}
        polygon(bg,[{x:x-3,y:y-3},{x:x+65,y:y+31},{x:x+65,y:y+35},{x:x-3,y:y+1}],'#576373');
        polygon(bg,[{x:x-3,y:y-3},{x:x+1,y:y-1},{x:x+1,y:y+86},{x:x-3,y:y+84}],'#576373');
        polygon(bg,[{x:x+30,y:y+14},{x:x+34,y:y+16},{x:x+34,y:y+101},{x:x+30,y:y+99}],'#697383');
      }
      for(let y=0;y<8;y++)for(let x=0;x<12;x++){tile(bg,x,y,(x+y)%2===0?colors.floor:(period==='evening'?'#b99069':'#e5c89f'));const p=iso(x,y);polygon(bg,[{x:p.x-26,y:p.y},{x:p.x,y:p.y+13},{x:p.x+2,y:p.y+12},{x:p.x-24,y:p.y-1}],period==='evening'?'#997553':'#c9a97f');}
      const a=iso(0,7),b=iso(11,7),c=iso(11,0);polygon(bg,[{x:a.x-30,y:a.y},{x:b.x,y:b.y+15},{x:b.x,y:b.y+33},{x:a.x-30,y:a.y+18}],'#806750');polygon(bg,[{x:b.x,y:b.y+15},{x:c.x+30,y:c.y},{x:c.x+30,y:c.y+18},{x:b.x,y:b.y+33}],'#6b5949');
      // Exposed beams and a fixed bookcase belong to the building, not the editor.
      polygon(bg,[{x:69,y:156},{x:338,y:20},{x:338,y:31},{x:69,y:168}],'#687180');rect(bg,69,156,7,131,'#535e6c');
      polygon(bg,[{x:334,y:19},{x:701,y:204},{x:701,y:215},{x:334,y:30}],'#687180');rect(bg,696,207,7,121,'#535e6c');
      // Left poster is drawn exactly once and keeps the requested brand sentence.
      polygon(bg,[{x:155,y:126},{x:222,y:93},{x:222,y:168},{x:155,y:201}],'#f4f1e9');
      bg.save();bg.setTransform(1,-.49,0,1,164,139);bg.fillStyle='#3f6488';bg.font='bold 10px Barlow, sans-serif';(hooks.vision?.() || []).forEach((line,index)=>bg.fillText(line,0,index*16));bg.restore();
      for(let i=0;i<3;i++){const x=245+i*23,y=102-i*11;rect(bg,x,y,20,71,'#8f7658');rect(bg,x+2,y+3,16,66,'#4b4845');for(let j=0;j<4;j++){rect(bg,x+2,y+16+j*15,16,2,'#b08c65');for(let k=0;k<3;k++)rect(bg,x+3+k*5,y+6+j*15,3,9,['#8191a1','#d8d2bf','#ab8c70'][(j+k)%3]);}}
      // Small caption boards, tactile pin samples and a coffee nook.
      cube(bg,9,0,1.3,.6,42,'#e2dbce','#afa89c','#94928c');rect(bg,600,225,9,13,'#d9d8cd');rect(bg,610,235,7,8,'#5d7282');
      dirty=false;
    }
    function furniture(c,item,highlight=false){
      const x=item.x,y=item.y,p=iso(x,y),r=item.rotation===1,wood=period==='evening'?'#ac875f':'#cba476';
      if(item.kind==='rug'){for(let j=0;j<2;j++)for(let i=0;i<2;i++)tile(c,x+i,y+j,(i+j)%2?'#8a9bab':'#718b9e');return;}
      if(item.kind==='desk'||item.kind==='table'){
        cube(c,x,y,r?.7:1.5,r?1.5:.7,21,wood,'#9a795a','#856c55');
        for(const [dx,dy]of[[0,0],[r?.6:1.35,0],[0,r?1.35:.6]]){const foot=iso(x+dx,y+dy);rect(c,foot.x,foot.y-20,3,20,'#465463');}
        if(item.kind==='desk'){cube(c,x+.45,y+.2,.6,.06,37,'#465564','#263543','#435264');const screen=iso(x+.53,y+.18);rect(c,screen.x+1,screen.y-35,12,10,'#8fb4d8');rect(c,screen.x+3,screen.y-32,8,1,'#d4e2e9');cube(c,x+.15,y+.42,.5,.12,24,'#ece9dd','#c1c3bf','#aaafad');cube(c,x+.6,y+1,.5,.4,16,'#52677b','#394a5d','#293b4b');}
        else{cube(c,x+.1,y+.18,.3,.28,24,'#d8d4c7','#adaca6','#888c8c');const mug=iso(x+1.1,y+.3);rect(c,mug.x,mug.y-28,5,7,'#3f6488');}
      }else if(item.kind==='sofa'){
        cube(c,x,y,r?.8:1.8,r?1.8:.8,23,'#e5e0d6','#aaa69f','#9c9d97');cube(c,x,y,r?.13:1.8,r?1.8:.13,38,'#ded9ce','#b2afa5','#aaa79e');cube(c,x+.4,y+.3,.35,.3,29,'#6e8ca7','#516f8c','#456380');
      }else if(item.kind==='plant'){
        cube(c,x,y,.45,.45,16,'#ddc6a4','#ab9375','#927d64');rect(c,p.x,p.y-44,3,31,'#536650');for(let i=0;i<7;i++){const dx=(i%2?1:-1)*(5+i%3*3);rect(c,p.x+dx-3,p.y-44+i*3,8,6,['#60764e','#738862','#435f43'][i%3]);}
      }else if(item.kind==='shelf'){
        cube(c,x,y,r?.4:1.1,r?1.1:.4,56,wood,'#7c6851','#816a52');for(let i=0;i<3;i++){rect(c,p.x+2,p.y-48+i*13,24,2,'#4e4b47');for(let j=0;j<4;j++)rect(c,p.x+3+j*5,p.y-46+i*13,3,8,['#8296a7','#d8ccb5','#6f8271'][j%3]);}
      }else if(item.kind==='rack'){
        rect(c,p.x,p.y-51,2,52,'#4d5a66');rect(c,p.x+28,p.y-36,2,49,'#4d5a66');polygon(c,[{x:p.x,y:p.y-52},{x:p.x+30,y:p.y-37},{x:p.x+30,y:p.y-34},{x:p.x,y:p.y-49}],'#4d5a66');for(let i=0;i<5;i++)rect(c,p.x+3+i*5,p.y-43+i*2,7,26,['#a1afba','#526980','#d7cbb6','#77796a'][i%4]);
      }else if(item.kind==='lamp'){
        rect(c,p.x,p.y-50,2,50,'#535b64');rect(c,p.x-6,p.y-3,14,3,'#46505c');rect(c,p.x-7,p.y-52,17,12,period==='evening'?'#edc888':'#ded4bd');if(period==='evening'){c.globalAlpha=.08;tile(c,x,y,'#fff2c0');c.globalAlpha=1;}
      }
      if(highlight){c.strokeStyle='#8fb4d8';c.lineWidth=2;c.strokeRect(p.x-20,p.y-65,65,85);}
    }
    function character(c,profile,point,step=false){
      const x=Math.round(point.x),y=Math.round(point.y),a=profile.avatar||{},skin=SKIN[a.skin||0],clothes=CLOTHES[a.clothes]||CLOTHES.blue;
      c.globalAlpha=.18;rect(c,x-6,y-2,14,4,'#253343');c.globalAlpha=1;
      rect(c,x-4,y-11+(step?1:0),4,10,'#334251');rect(c,x+2,y-11+(step?-1:0),4,10,'#334251');rect(c,x-5,y-2,6,3,'#354450');rect(c,x+2,y-2,6,3,'#354450');
      if(a.hair==='long')rect(c,x-7,y-37,16,25,'#4b3b32');
      rect(c,x-5,y-24,12,15,clothes);rect(c,x-9,y-23,4,13,clothes);rect(c,x+7,y-23,4,13,clothes);rect(c,x-9,y-12,4,4,skin);rect(c,x+7,y-12,4,4,skin);
      rect(c,x-5,y-35,12,12,skin);rect(c,x-6,y-38,14,5,'#453730');rect(c,x-6,y-34,3,7,'#453730');
      if(a.hair==='bun')rect(c,x-2,y-43,8,6,'#453730');if(a.hair==='short')rect(c,x+2,y-38,5,7,'#453730');
      rect(c,x-1,y-30,2,2,'#39414a');rect(c,x+5,y-30,2,2,'#39414a');
      if(a.accessory==='glasses'){rect(c,x-2,y-31,5,1,'#3f4b57');rect(c,x+4,y-31,5,1,'#3f4b57');}if(a.accessory==='headphones'){rect(c,x-8,y-34,3,9,'#6b8dab');rect(c,x+8,y-34,3,9,'#6b8dab');}
      const busy=data.activeJobs?.some(job=>job.profileIds.includes(profile.id));
      c.font='bold 10px Barlow, sans-serif';c.textAlign='center';c.fillStyle=busy?'#b18a58':'#edf0ef';const name=profile.name.slice(0,15);c.fillRect(x-c.measureText(name).width/2-5,y-60,c.measureText(name).width+10,15);c.fillStyle='#293b4d';c.fillText(name,x,y-49);
      if(profile.id===selected){c.strokeStyle='#8fb4d8';c.lineWidth=2;c.strokeRect(x-14,y-45,31,49);}
      if(busy){rect(c,x-1,y-69,3,3,'#8fb4d8');if(frame%8<4)rect(c,x+5,y-69,3,3,'#8fb4d8');}
    }
    function targetFor(profile,index){const desks=data.office.furniture.filter(item=>item.kind==='desk'),desk=desks.find(item=>item.id===profile.deskId)||desks[index];return desk?{x:desk.x,y:Math.min(7,desk.y+1)}:{x:2+index%8,y:4+Math.floor(index/8)%3};}
    function draw(timestamp=0){
      if(!active)return;
      motion=root.requestAnimationFrame(draw);if(timestamp-last<84&&!dirty)return;const elapsed=Math.min(.15,(timestamp-last)/1000 || .08);last=timestamp;frame++;
      const current=currentPeriod();if(current!==period){period=current;dirty=true;hooks.onPeriod?.(period);}if(dirty)floor();
      ctx.clearRect(0,0,W,H);ctx.drawImage(background,0,0);
      // One small softly pulsing LCW ornament, never duplicated in the palette.
      ctx.fillStyle=reduced.matches?'#8fb4d8':`rgba(143,180,216,${.75+Math.sin(timestamp/1800)*.12})`;ctx.fillRect(269,119,21,13);ctx.font='bold 10px Barlow, sans-serif';ctx.textAlign='left';ctx.fillStyle='#f4f7f9';ctx.fillText('LCW',270,130);
      const occupied=new Set(data.office.furniture.filter(item=>block(item.kind)).map(item=>`${item.x},${item.y}`));
      const objects=data.office.furniture.map(item=>({depth:item.x+item.y,draw:()=>furniture(ctx,item,drag?.id===item.id)}));
      data.profiles.forEach((profile,index)=>{
        const target=targetFor(profile,index);let actor=actors.get(profile.id);
        if(!actor){actor={x:target.x,y:target.y,path:[],nextWalk:timestamp+4000+index*900};actors.set(profile.id,actor);}
        if(!reduced.matches&&!editing&&timestamp>actor.nextWalk&&!actor.path.length){
          const end=frame%3?target:{x:Math.min(10,3+index*2),y:6};occupied.delete(`${end.x},${end.y}`);actor.path=pathBetween(actor,end,occupied);actor.nextWalk=timestamp+11000+index*700;
        }
        if(actor.path.length){const goal=actor.path[0],dx=goal.x-actor.x,dy=goal.y-actor.y,dist=Math.hypot(dx,dy),speed=elapsed*1.5;if(dist<speed){actor.x=goal.x;actor.y=goal.y;actor.path.shift();}else{actor.x+=dx/dist*speed;actor.y+=dy/dist*speed;}}
        const p=iso(actor.x,actor.y);objects.push({depth:actor.x+actor.y+.4,draw:()=>character(ctx,profile,p,actor.path.length>0&&frame%4<2)});
      });
      objects.sort((a,b)=>a.depth-b.depth).forEach(object=>object.draw());
      if(editing){ctx.strokeStyle='rgba(63,100,136,.28)';ctx.lineWidth=1;for(let y=0;y<8;y++)for(let x=0;x<12;x++){const p=iso(x,y);ctx.strokeRect(p.x-2,p.y-2,4,4);}}
      if(reduced.matches){root.cancelAnimationFrame(motion);motion=null;}
    }
    function coordinate(event){const bounds=canvas.getBoundingClientRect();return{x:(event.clientX-bounds.left)*W/bounds.width,y:(event.clientY-bounds.top)*H/bounds.height};}
    canvas.addEventListener('pointerdown',event=>{
      const point=coordinate(event);
      if(editing){const hit=[...data.office.furniture].reverse().find(item=>{const p=iso(item.x,item.y);return Math.abs(point.x-p.x)<35&&point.y>p.y-65&&point.y<p.y+25;});if(hit){drag={...hit};canvas.setPointerCapture(event.pointerId);dirty=true;resume();}return;}
      const hit=data.profiles.find(profile=>{const actor=actors.get(profile.id);if(!actor)return false;const p=iso(actor.x,actor.y);return Math.abs(point.x-p.x)<22&&point.y>p.y-65&&point.y<p.y+6;});if(hit){selected=hit.id;hooks.onSelect?.(hit.id);dirty=true;resume();}
    });
    canvas.addEventListener('pointermove',event=>{if(!drag)return;const p=coordinate(event),cell=uniso(p.x,p.y);if(cell.x<0||cell.x>11||cell.y<0||cell.y>7)return;const item=data.office.furniture.find(item=>item.id===drag.id);if(item){item.x=cell.x;item.y=cell.y;dirty=true;resume();}});
    canvas.addEventListener('pointerup',event=>{if(!drag)return;const item=data.office.furniture.find(item=>item.id===drag.id);if(data.office.furniture.some(other=>other.id!==item.id&&block(other.kind)&&block(item.kind)&&other.x===item.x&&other.y===item.y)){Object.assign(item,drag);hooks.onCollision?.();}else hooks.onLayout?.(JSON.parse(JSON.stringify(data.office)));drag=null;canvas.releasePointerCapture(event.pointerId);dirty=true;resume();});
    function resume(){if(active&&motion==null)motion=root.requestAnimationFrame(draw);}
    function pause(){active=false;if(motion!=null)root.cancelAnimationFrame(motion);motion=null;}
    return{update(value){data=value;dirty=true;resume();},select(key){selected=key;dirty=true;resume();},edit(value){editing=value;dirty=true;resume();},start(){active=true;last=0;resume();},pause,
      add(kind){const occupied=new Set(data.office.furniture.filter(item=>block(item.kind)).map(item=>`${item.x},${item.y}`));for(let y=1;y<8;y++)for(let x=0;x<12;x++)if(!occupied.has(`${x},${y}`)){data.office.furniture.push({id:root.crypto.randomUUID(),kind,x,y,rotation:0});dirty=true;hooks.onLayout?.(JSON.parse(JSON.stringify(data.office)));resume();return;}hooks.onCollision?.();},
      rotate(key){const item=data.office.furniture.find(item=>item.id===(key || drag?.id));if(item){item.rotation=item.rotation?0:1;dirty=true;hooks.onLayout?.(data.office);}},
      remove(key){data.office.furniture=data.office.furniture.filter(item=>item.id!==key);dirty=true;hooks.onLayout?.(JSON.parse(JSON.stringify(data.office)));resume();},
      destroy:pause};
  }
  root.BLAgentOfficeScene={create,pathBetween,periodForHour:hour=>hour>=6&&hour<11?'morning':hour>=11&&hour<18?'noon':'evening'};
})(window);
