(function(root){
  'use strict';
  const WIDTH={desk:4,table:5,sofa:4,shelf:2,coffee:3,rack:2,plant:1,lamp:1,chair:1,mannequin:1,monstera:1,board:3,decor:1,rug:5};
  const STAIRS={upper:{x:0,y:3,floor:1},lower:{x:6,y:3,floor:0}};
  const styles=kind=>kind==='desk'?['classic','planning','collection','quality']:kind==='board'?['classic','planning','collection','quality','portrait','moodboard']:kind==='shelf'?['classic','library']:kind==='decor'?['classic','sketch','textile']:['classic'];
  const passive=item=>['rug','board','decor','lamp'].includes(item.kind);
  const scalable=kind=>['desk','table','sofa','coffee','rug'].includes(kind);
  const scale=item=>scalable(item.kind)&&Number(item.scale)===1.3?1.3:1;
  const footprint=item=>item.kind==='shelf'&&item.style==='library'?3.5:WIDTH[item.kind];
  const box=item=>({left:item.x-footprint(item)*scale(item)/2,right:item.x+footprint(item)*scale(item)/2,top:item.y-.5,bottom:item.y+.5});
  function validPlacement(item,items){
    if(!WIDTH[item.kind]||![0,1].includes(item.floor)||item.y<0||item.y>3)return false;
    const a=box(item);if(a.left<0||a.right>24)return false;
    if(!passive(item)&&item.y===3&&(item.floor===1?a.left<4:a.left<8&&a.right>4))return false;
    return passive(item)||!items.some(other=>{if(other.id===item.id||other.floor!==item.floor||passive(other))return false;const b=box(other);return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});
  }
  const key=p=>`${p.floor}:${p.x}:${p.y}`;
  function blocked(p,items){return p.x<0||p.x>23||p.y<0||p.y>3||![0,1].includes(p.floor)||items.some(item=>{if(passive(item)||item.floor!==p.floor)return false;const b=box(item);return p.x+.5>b.left&&p.x+.5<b.right&&p.y===item.y;});}
  function neighbors(p){const list=[{...p,x:p.x-1},{...p,x:p.x+1},{...p,y:p.y-1},{...p,y:p.y+1}];if(key(p)===key(STAIRS.upper))list.push({...STAIRS.lower});if(key(p)===key(STAIRS.lower))list.push({...STAIRS.upper});return list;}
  function path(start,end,items){
    if(blocked(start,items)||blocked(end,items))return [];
    const queue=[start],seen=new Map([[key(start),null]]),points=new Map([[key(start),start]]);
    for(let index=0;index<queue.length&&index<192;index++){const current=queue[index];if(key(current)===key(end)){const result=[];let k=key(current);while(seen.get(k)!==null){result.unshift(points.get(k));k=seen.get(k);}return result;}
      for(const next of neighbors(current)){const k=key(next);if(!seen.has(k)&&!blocked(next,items)){seen.set(k,key(current));points.set(k,next);queue.push(next);}}}
    return [];
  }
  function nearest(point,items){const candidates=[];for(let floor=0;floor<2;floor++)for(let y=0;y<4;y++)for(let x=0;x<24;x++){const p={floor,x,y};if(!blocked(p,items))candidates.push(p);}return candidates.sort((a,b)=>Math.abs(a.x-point.x)+Math.abs(a.y-point.y)+Math.abs(a.floor-point.floor)*30-(Math.abs(b.x-point.x)+Math.abs(b.y-point.y)+Math.abs(b.floor-point.floor)*30))[0]||null;}
  function meetingPoint(table,index){return{x:Math.round(table.x+(index%2===0?-1:1)),y:Math.max(0,Math.min(3,table.y+(index<2?1:-1))),floor:table.floor};}
  function stations(profiles,items){const desks=items.filter(p=>p.kind==='desk'),used=new Set(),assigned=new Map(),occupied=[];for(const profile of profiles){const desk=desks.find(p=>p.id===profile.deskId&&!used.has(p.id))||desks.find(p=>!used.has(p.id));if(desk)used.add(desk.id);const point=nearest(desk?{x:desk.x,y:Math.min(3,desk.y+1),floor:desk.floor}:{x:4+assigned.size%19,y:3,floor:0},items.concat(occupied));assigned.set(profile.id,{desk:desk||null,point});if(point)occupied.push({id:'station:'+profile.id,kind:'plant',x:point.x+.5,y:point.y,floor:point.floor});}return assigned;}
  const periodForHour=hour=>hour>=6&&hour<11?'morning':hour>=11&&hour<17?'noon':hour>=17&&hour<21?'evening':'night';
  function status(profileId,data){const active=(data.activeJobs||[]).find(j=>j.profileIds?.includes(profileId));if(active)return active.phase==='review'?'reviewing':active.phase==='responding'?'responding':'working';const last=(data.jobs||[]).find(j=>j.profileIds?.includes(profileId));if(last?.status==='failed')return 'error';if((data.memory||[]).some(m=>m.profileId===profileId&&m.type==='task'&&m.active))return 'waiting';return data.connected===false?'offline':'available';}
  const model={STAIRS,styles,meetingPoint,WIDTH,scale,scalable,passive,box,validPlacement,blocked,path,nearest,stations,periodForHour,status};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.BLWorkshopModel=model;
})(typeof window==='undefined'?globalThis:window);
