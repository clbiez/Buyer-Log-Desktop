'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const flow=require('../public/overview-global-flow.js');
const routes=require('../public/overview-flow-routes.js');
const topology=require('../public/vendor/world-atlas-countries-50m.json');

test('sea legs start at actual reference ports and stop at Ambarli; air legs use airports and altitude',()=>{
 for(const country of Object.keys(routes.PORTS)){
  const leg=flow.routeLegsFor(country,'sea')[0];assert.ok(leg,country);
  assert.deepEqual(leg.points[0],{lon:routes.PORTS[country].lon,lat:routes.PORTS[country].lat});
  assert.deepEqual(leg.points.at(-1),{lon:28.683,lat:40.967});
  for(const edge of flow.routeEdges([leg]))assert.ok(flow.edgeSamples(edge).every(p=>p.alt===0));
 }
 const air=flow.routeLegsFor('Bangladesh','air')[0];
 assert.deepEqual(air.points,[{lon:90.3978,lat:23.8433},{lon:28.7519,lat:41.2753}]);
 assert.ok(flow.edgeSamples(flow.routeEdges([air])[0]).some(p=>p.alt>0));
});

test('sea-air preserves Colombo/Dubai transfers and distinguishes sea terminals from airports',()=>{
 for(const country of ['Bangladesh','India','China','Pakistan']){
  const [sea,air]=flow.routeLegsFor(country,'sea-air');assert.equal(sea.mode,'sea');assert.equal(air.mode,'air');
  const airport=['Bangladesh','India'].includes(country)?routes.COLOMBO_AIRPORT:routes.DUBAI_AIRPORT;
  assert.deepEqual(air.points[0],{lon:airport.lon,lat:airport.lat});
  assert.notDeepEqual(sea.points.at(-1),air.points[0],'port-to-airport ground transfer must not be drawn as a sea or air leg');
 }
 assert.deepEqual(flow.routeLegsFor('Serbia','sea'),[],'never draw a sea link from a landlocked country centroid');
 assert.deepEqual(flow.routeLegsFor('Bangladesh','road'),[],'no invented straight road across continents');
 assert.deepEqual(flow.routeLegsFor('Unknown country','air'),[]);
});

test('reference sea corridors avoid land, including Sri Lanka, Singapore, Aegean islands and Oman',()=>{
 const polygons=flow.decodeWorldTopology(topology).map(poly=>({poly,
  minX:Math.min(...poly[0].map(p=>p[0])),maxX:Math.max(...poly[0].map(p=>p[0])),
  minY:Math.min(...poly[0].map(p=>p[1])),maxY:Math.max(...poly[0].map(p=>p[1]))}));
 function inRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [x,y]=ring[i],[u,v]=ring[j];if((y>point.lat)!==(v>point.lat)&&point.lon<(u-x)*(point.lat-y)/(v-y)+x)inside=!inside;
 }return inside;}
 function onLand(p){return polygons.some(x=>x.maxX-x.minX<180&&p.lon>x.minX&&p.lon<x.maxX&&p.lat>x.minY&&p.lat<x.maxY&&x.poly.reduce((inside,ring)=>inside!==inRing(p,ring),false));}
 function channelOrHarbour(p){
  // Natural Earth 1:50m does not resolve these narrow, real navigation channels.
  const suez=p.lon>32.1&&p.lon<32.75&&p.lat>29.55&&p.lat<31.5;
  const dardanelles=p.lon>26&&p.lon<26.9&&p.lat>39.85&&p.lat<40.5;
  const bosphorus=p.lon>28.95&&p.lon<29.25&&p.lat>40.95&&p.lat<41.4;
  const harbour=routes.terminals.some(t=>Math.hypot((t.lon-p.lon)*Math.cos(p.lat*Math.PI/180),t.lat-p.lat)<.22);
  return suez||dardanelles||bosphorus||harbour;
 }
 const errors=[];let checked=0;
 for(const country of Object.keys(routes.PORTS))for(const mode of ['sea','sea-air']){
  for(const leg of flow.routeLegsFor(country,mode).filter(l=>l.mode==='sea'))for(const edge of flow.routeEdges([leg])){
   const steps=Math.max(1,Math.ceil(Math.hypot(edge.b.lon-edge.a.lon,edge.b.lat-edge.a.lat)*10));
   for(let i=0;i<=steps;i++){
    const p=flow.geoInterpolate(edge.a,edge.b,i/steps);checked++;
    if(!channelOrHarbour(p)&&onLand(p))errors.push(`${country} ${mode} ${p.lon.toFixed(3)},${p.lat.toFixed(3)}`);
   }
  }
 }
 assert.ok(checked>10000);assert.deepEqual(errors,[]);
});

test('terminal markers and shipment positions use the same shared route model',()=>{
 const rec=flow.normalizeRecord({'Order Code':'DEMO','Country':'Bangladesh','Status':'In Transit','Shipment Mode':'Sea','HANDOVER Tarihi':'2026-10-01'},'orders',0);
 const model=flow.buildFlowModel([rec],{now:Date.UTC(2026,9,18)}),hubs=flow.referenceHubs(model);
 assert.equal(hubs.length,2);assert.equal(hubs[0].name,'Chattogram');assert.equal(hubs[1].name,'Ambarli');
 assert.equal(hubs[0].records[0],rec);assert.equal(hubs[0].location.lon,91.8);
});
