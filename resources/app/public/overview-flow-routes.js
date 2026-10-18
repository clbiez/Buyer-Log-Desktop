/* Reference transport geography (WGS84 lon/lat). These are real terminals and
   navigable reference corridors, not a claim about an individual vessel's
   booked port or live AIS/GPS position. Never join an unknown seaport to a
   country centroid. The map renderer and its visual palette are unchanged. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOverviewFlowRoutes=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const point=(name,lon,lat)=>Object.freeze({name,lon,lat});
  const ARRIVAL_PORT=point('Ambarli',28.683,40.967);
  const ARRIVAL_AIRPORT=point('Istanbul Airport',28.7519,41.2753);
  const COLOMBO_PORT=point('Colombo',79.842,6.948);
  const COLOMBO_AIRPORT=point('Colombo Airport',79.8841,7.1808);
  const DUBAI_PORT=point('Jebel Ali',55.061,24.995);
  const DUBAI_AIRPORT=point('Al Maktoum Airport',55.1614,24.8964);
  const PORTS=Object.freeze({
    Bangladesh:point('Chattogram',91.80,22.31),India:point('Nhava Sheva',72.951,18.95),
    China:point('Yangshan',122.064,30.626),Egypt:point('Alexandria',29.87,31.19),
    Georgia:point('Poti',41.657,42.16),Pakistan:point('Karachi',66.975,24.803),
    Vietnam:point('Cai Mep',107.03,10.52),Indonesia:point('Tanjung Priok',106.887,-6.098),
    Cambodia:point('Sihanoukville',103.503,10.636),Myanmar:point('Thilawa',96.255,16.665),
    'Sri Lanka':COLOMBO_PORT,Morocco:point('Tanger Med',-5.5,35.887),
    Tunisia:point('Rades',10.28,36.81),Portugal:point('Lisbon',-9.15,38.69),
    Spain:point('Algeciras',-5.43,36.13),Italy:point('Augusta',15.22,37.22),
    Greece:point('Piraeus',23.625,37.94),Germany:point('Bremerhaven',8.57,53.54),
    'United Kingdom':point('Felixstowe',1.316,51.955),Bulgaria:point('Varna',27.915,43.19),
    Romania:point('Constanta',28.65,44.10),UAE:DUBAI_PORT,
    'Saudi Arabia':point('Jeddah',39.15,21.48),'South Korea':point('Busan',129.045,35.10),
    Japan:point('Yokohama',139.69,35.44),USA:point('New York',-74.10,40.67),
    Mexico:point('Veracruz',-96.13,19.20),Brazil:point('Santos',-46.30,-23.98),
    'South Africa':point('Cape Town',18.435,-33.90),Australia:point('Fremantle',115.74,-32.05),
  });
  const AIRPORTS=Object.freeze({
    Bangladesh:point('Dhaka Airport',90.3978,23.8433),India:point('Mumbai Airport',72.8679,19.0896),
    China:point('Shanghai Pudong Airport',121.8052,31.1443),Egypt:point('Cairo Airport',31.4056,30.1219),
    Georgia:point('Tbilisi Airport',44.9547,41.6692),Pakistan:point('Karachi Airport',67.1608,24.9065),
    Vietnam:point('Ho Chi Minh City Airport',106.652,10.8188),Indonesia:point('Jakarta Airport',106.6559,-6.1256),
    Cambodia:point('Phnom Penh Airport',104.8441,11.5466),Myanmar:point('Yangon Airport',96.1332,16.9073),
    'Sri Lanka':COLOMBO_AIRPORT,Morocco:point('Casablanca Airport',-7.5898,33.3675),
    Tunisia:point('Tunis Airport',10.2272,36.851),Portugal:point('Lisbon Airport',-9.1342,38.7742),
    Spain:point('Madrid Airport',-3.5676,40.4983),Italy:point('Milan Malpensa Airport',8.7281,45.6306),
    Germany:point('Frankfurt Airport',8.5706,50.0379),'United Kingdom':point('London Heathrow Airport',-.4543,51.47),
    Bulgaria:point('Sofia Airport',23.4114,42.6967),Romania:point('Bucharest Airport',26.1022,44.5711),
    Serbia:point('Belgrade Airport',20.3091,44.8184),'North Macedonia':point('Skopje Airport',21.6214,41.9616),
    Greece:point('Athens Airport',23.9475,37.9364),UAE:DUBAI_AIRPORT,
    'Saudi Arabia':point('Jeddah Airport',39.1565,21.6796),'South Korea':point('Incheon Airport',126.4407,37.4602),
    Japan:point('Narita Airport',140.3929,35.772),USA:point('New York JFK Airport',-73.7781,40.6413),
    Mexico:point('Mexico City Airport',-99.0721,19.4361),Brazil:point('Sao Paulo Airport',-46.4731,-23.4356),
    'South Africa':point('Cape Town Airport',18.6021,-33.9715),Australia:point('Perth Airport',115.9672,-31.9403),
  });
  const pairs=points=>points.map(p=>Array.isArray(p)?[p[0],p[1]]:[p.lon,p.lat]);
  function coordinates(points){
    return pairs(points).filter((p,i,a)=>!i||Math.abs(p[0]-a[i-1][0])+Math.abs(p[1]-a[i-1][1])>.000001).map(([lon,lat])=>({lon,lat}));
  }
  /* Dardanelles follows the channel; arrival ends at the Ambarli cargo port,
     never at an inland warehouse or at the city centroid. */
  const DARDANELLES=[[25.7,39.7],[26.10,39.9],[26.18,40.03],[26.25,40.05],[26.38,40.14],[26.4,40.2],[26.5,40.30],[26.69,40.44],[27.3,40.6],[27.7,40.7],[28.4,40.88],ARRIVAL_PORT];
  const AEGEAN=[[27.1,34.5],[27.7,35.3],[27.2,36.3],[26,37],[25.8,37.5],[25.5,38],[25.4,38.8],[25.7,39.4],...DARDANELLES];
  const WEST_AEGEAN=[[23,36],[23.6,36.7],[24.1,37],[24.3,37.4],[24.5,37.9],[24.7,38.15],[24.8,38.5],[25,39],[25.7,39.4],...DARDANELLES];
  const SUEZ=[[32.55,29.6],[32.56,29.93],[32.55,30],[32.48,30.25],[32.34,30.45],[32.31,30.6],[32.32,30.85],[32.31,31.10],[32.30,31.26],[32.33,31.45],[31.9,32],[29.2,33.4],...AEGEAN];
  const RED_SEA=[[48,12.2],[43.4,12.6],[42.5,14],[40.5,18],[39,20],[36.9,24],[35,27.2],[34.4,27.4],[34.1,27.55],[33.8,27.8],[33.55,28],[33.25,28.4],[33,28.8],[32.78,29.2],[32.6,29.55],...SUEZ];
  const INDIAN_OCEAN=[[72,8],[59,11.5],...RED_SEA];
  const SOUTH_SRI_LANKA=[[82,6],[81,5.5],[80,5.3],[78,6],...INDIAN_OCEAN];
  const MALACCA=[[104.6,1.5],[104.4,1.3],[104.3,1.25],[104.1,1.22],[103.9,1.2],[103.7,1.2],[103.55,1.16],[103.3,1.2],[102.1,2],[101.5,2.5],[100.7,3.7],[100,4.5],[99.1,5.3],[97.5,6.2],[94,6],[85,5.3],...SOUTH_SRI_LANKA.slice(1)];
  const WEST_MED=[[-5.5,35.9],[-3.5,36],[1,38],[6,38.3],[10,38.6],[11,37.5],[16,36.3],[22,35.3],...WEST_AEGEAN];
  const HORMUZ=[[64,16],[61,21.5],[60.5,23],[59,24],[57,25],[56.55,26.5],[56.15,26.6],[55.5,25.7],[54.95,25.4],[54.95,25.15],DUBAI_PORT];
  function sea(country){
    const port=PORTS[country];if(!port)return [];
    let route;
    switch(country){
      case 'Bangladesh':route=[port,[90,17],[88,15],[85,10],...SOUTH_SRI_LANKA];break;
      case 'India':route=[port,[72.87,18.83],[72.7,18.65],[66,15],[59,11.5],...RED_SEA];break;
      case 'Pakistan':route=[port,[66.6,24.4],[62,18],[56,13],...RED_SEA];break;
      case 'Sri Lanka':route=[port,[79.5,6.5],[78,6],...INDIAN_OCEAN];break;
      case 'China':route=[port,[122.4,30.5],[122,28],[121,25.6],[119.9,24.2],[118,22.2],[115,18],[110,12],[108,7],[105.5,3.2],...MALACCA];break;
      case 'Vietnam':route=[port,[107.2,10.2],[108,7],[105.5,3.2],...MALACCA];break;
      case 'Cambodia':route=[port,[103.4,10],[103,8],[104.4,3],[104.6,1.5],...MALACCA.slice(1)];break;
      case 'Myanmar':route=[port,[96.3,16.4],[96.35,16.2],[96.3,16.1],[96.2,15.8],[95.8,15.5],[95,15.2],[94,13],[92,9],[85,6],...SOUTH_SRI_LANKA];break;
      case 'Indonesia':route=[port,[106.7,-5.5],[106,-5.5],[105.9,-5.9],[105.5,-6.1],[105.1,-6.4],[104.5,-6.5],[101,-5],[97,-3],[94,3],[85,5.3],...SOUTH_SRI_LANKA.slice(1)];break;
      case 'Japan':route=[port,[139.75,35.25],[139.78,35.1],[139.72,34.9],[140,34.4],[136,31.5],[130,28],[125,25],[123.4,23],[118,19],[110,12],[108,7],[105.5,3.2],...MALACCA];break;
      case 'South Korea':route=[port,[129.2,34.6],[127,33],[125.5,29],[123,25.5],[121,25.6],[119.9,24.2],[118,22.2],[115,18],[110,12],[108,7],[105.5,3.2],...MALACCA];break;
      case 'UAE':route=[port,[54.95,25.15],[54.95,25.4],[55.5,25.7],[56.15,26.6],[56.55,26.5],[57,25],[59,24],[60.5,23],[61,21.5],[60,18],[55,14],...RED_SEA];break;
      case 'Saudi Arabia':route=[port,[38.8,21.4],[37.8,23],[36.9,24],[35,27.2],[34.4,27.4],[34.1,27.55],[33.8,27.8],[33.55,28],[33.25,28.4],[33,28.8],[32.78,29.2],[32.6,29.55],...SUEZ];break;
      case 'Egypt':route=[port,[29.8,31.5],[29,32],[27.5,33.5],...AEGEAN];break;
      case 'Georgia':route=[port,[41.3,42.3],[39,42.2],[35,42.1],[30.2,41.8],[29.15,41.3],[29.12,41.23],[29.07,41.15],[29.04,41.1],[29.055,41.07],[29.035,41.045],[29.008,41.02],[28.99,40.98],[28.85,40.9],ARRIVAL_PORT];break;
      case 'Morocco':route=[port,...WEST_MED];break;
      case 'Portugal':route=[port,[-9.4,38.4],[-9.6,37.1],[-9,36.5],...WEST_MED];break;
      case 'Spain':route=[port,[-5.35,36.03],...WEST_MED];break;
      case 'Tunisia':route=[port,[10.35,37.1],[10.5,37.45],[11,37.5],[16,36.3],[22,35.3],...WEST_AEGEAN];break;
      case 'Italy':route=[port,[15.5,37.2],[19,36],[22,35.3],...WEST_AEGEAN];break;
      case 'Greece':route=[port,[23.6,37.7],[24.1,37.5],[24.5,37.9],[24.7,38.15],[24.8,38.5],[25,39],[25.7,39.4],...DARDANELLES];break;
      case 'Romania':route=[port,[28.8,43.9],[29,42.5],[29.15,41.3],...sea('Georgia').filter(p=>p.lat<41.3)];break;
      case 'Bulgaria':route=[port,[28.2,43.1],[29,42],[29.15,41.3],...sea('Georgia').filter(p=>p.lat<41.3)];break;
      case 'Germany':route=[port,[8.4,53.7],[8.2,53.9],[7.5,54],[6,54.2],[4,54],[3,53],[2,52],[1.8,51.3],[1.5,50.9],[0,50.5],[-2,49.8],[-5.5,49.5],[-8,46],[-11,44],[-11,40],[-9.6,37.1],[-9,36.5],...WEST_MED];break;
      case 'United Kingdom':route=[port,[1.8,51.7],[1.8,51.3],[1.5,50.9],[0,50.5],[-2,49.8],[-5.5,49.5],[-8,46],[-11,44],[-11,40],[-9.6,37.1],[-9,36.5],...WEST_MED];break;
      case 'South Africa':route=[port,[18.1,-34.3],[5,-28],[-2,-15],[-5,0],[-18,5],[-24,15],[-22,25],[-16,32],[-9,35],...WEST_MED];break;
      case 'Australia':route=[port,[115.3,-32],[100,-25],[88,-10],[80,2],...INDIAN_OCEAN];break;
      case 'USA':route=[port,[-74.05,40.45],[-73.5,40.25],[-70,39],[-50,39],[-30,40],[-20,39],[-12,36],...WEST_MED];break;
      case 'Mexico':route=[port,[-95.6,19.3],[-90,24],[-85,24],[-83.7,23.4],[-82,23.7],[-80,24],[-79,26],[-79.4,27.8],[-78,28.5],[-75,29],[-60,33],[-30,35],[-20,36],[-12,36],...WEST_MED];break;
      case 'Brazil':route=[port,[-46.2,-24.2],[-40,-23],[-25,-5],[-22,18],[-20,25],[-16,30],[-12,35],...WEST_MED];break;
      default:return [];
    }
    return coordinates(route);
  }
  function colomboSea(country){
    if(country==='Bangladesh')return coordinates([PORTS.Bangladesh,[90,17],[88,15],[85,10],[82,6],[81,5.5],[80,5.3],[79.5,6.1],[79.6,6.7],COLOMBO_PORT]);
    if(country==='India')return coordinates([point('Thoothukudi',78.203,8.752),[78.6,8.4],[79.3,7.9],[79.6,7.5],COLOMBO_PORT]);
    return [];
  }
  function dubaiSea(country){
    if(country==='UAE')return [DUBAI_PORT];
    const full=sea(country);if(!full.length)return [];
    const index=full.findIndex(p=>Math.abs(p.lon-59)<.01&&Math.abs(p.lat-11.5)<.01);
    if(index>=0)return coordinates([...full.slice(0,index),...HORMUZ]);
    if(country==='Pakistan')return coordinates([PORTS.Pakistan,[66.6,24.4],[64,23],[60,23.5],...HORMUZ.slice(2)]);
    return [];
  }
  const ROAD_TO_ISTANBUL=[[26.56,41.67],[27.36,41.67],[27.92,41.4],[28.35,41.12],[28.9784,41.0082]];
  const ROADS=Object.freeze({
    Georgia:[[44.8,41.72],[42.7,42.25],[41.65,41.65],[41.55,41.52],[40.52,41.03],[39.72,41],[37.88,40.98],[36.33,41.28],[34.67,40.55],[33.62,40.6],[32.63,40.6],[31.16,40.84],[30.4,40.77],[29.9,40.77],[29.25,40.83],[29.02,41.03],[28.9784,41.0082]],
    Bulgaria:[[23.32,42.70],[24.75,42.14],[25.56,41.77],...ROAD_TO_ISTANBUL],
    Romania:[[26.10,44.43],[25.97,43.89],[25.63,43.08],[25.63,42.42],[25.56,41.77],...ROAD_TO_ISTANBUL],
    Serbia:[[20.45,44.81],[21.90,43.32],[23.32,42.70],[24.75,42.14],[25.56,41.77],...ROAD_TO_ISTANBUL],
    'North Macedonia':[[21.43,41.998],[22.65,42.01],[23.32,42.70],[24.75,42.14],[25.56,41.77],...ROAD_TO_ISTANBUL],
    Greece:[[23.73,37.98],[22.4,39.64],[22.94,40.64],[24.41,41.12],[25.87,40.85],[26.1,40.89],[26.32,40.94],[26.7,41.02],[27.5,41.15],[28.9784,41.0082]],
    Germany:[[8.68,50.11],[11.08,49.45],[13.43,48.57],[14.29,48.31],[16.37,48.2],[19.04,47.5],[20.45,44.81],[21.90,43.32],[23.32,42.70],[24.75,42.14],[25.56,41.77],...ROAD_TO_ISTANBUL],
    Italy:[[9.19,45.46],[12.24,45.66],[14.51,46.06],[15.98,45.81],[20.45,44.81],[21.90,43.32],[23.32,42.70],[24.75,42.14],[25.56,41.77],...ROAD_TO_ISTANBUL],
  });
  return {PORTS,AIRPORTS,ARRIVAL_PORT,ARRIVAL_AIRPORT,COLOMBO_PORT,COLOMBO_AIRPORT,DUBAI_PORT,DUBAI_AIRPORT,
    terminals:[...Object.values(PORTS),...Object.values(AIRPORTS),ARRIVAL_PORT,ARRIVAL_AIRPORT,point('Thoothukudi',78.203,8.752)],
    sea,colomboSea,dubaiSea,road:country=>coordinates(ROADS[country]||[])};
});
