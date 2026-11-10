function mountMap(onPlace,onNotice){
  const canvas=document.querySelector('#atlas'), street=document.querySelector('#streetMap');
  const status=document.querySelector('#mapStatus'), credit=document.querySelector('#mapCredit');
  const ctx=canvas.getContext('2d'), rad=Math.PI/180;
  let gpuUnavailable=false;
  let width=1,height=1,lon=-4,lat=40,scale=6.1,world=[],pins=[],lines=[],picked=null,hit=[],frame=0,map=null,loaded=false,layer='street',token=null,viewPlace=null;
  let rotating=false, pickPoint=null, transit=false, pendingFit=null;
  const collection=features=>({type:'FeatureCollection',features});
  const libraryReady=()=>!!(map&&loaded);
  const stopRotation=()=>{rotating=false;};
  let lastSpin=0;
  function draw(timestamp){
    frame=0;
    if(libraryReady()){
      if(rotating&&!document.hidden){
        if(lastSpin){const center=map.getCenter();map.jumpTo({center:[(center.lng+Math.min(timestamp-lastSpin,100)*.0028+540)%360-180,center.lat]});}
        lastSpin=timestamp;schedule();
      }
      return;
    }
    if(rotating&&!document.hidden){if(lastSpin)lon=(lon+Math.min(timestamp-lastSpin,100)*.0028+540)%360-180;lastSpin=timestamp;schedule();}
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const radius=Math.min(width,height)*.42*scale,cx=width*.5,cy=height*(width<720?.34:.52);
    const sin=Math.sin(lat*rad),cos=Math.cos(lat*rad);
    function project([x,y]){
      const dl=(x-lon)*rad,phi=y*rad,c=Math.cos(phi),s=Math.sin(phi),cd=Math.cos(dl);
      return [cx+radius*c*Math.sin(dl),cy-radius*(cos*s-sin*c*cd),sin*s+cos*c*cd];
    }
    const sky=ctx.createLinearGradient(0,0,width,height);sky.addColorStop(0,'#d0ddd1');sky.addColorStop(1,'#97b9b8');
    ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.clip();
    const sea=ctx.createLinearGradient(0,0,width,height);sea.addColorStop(0,'#b8cec4');sea.addColorStop(1,'#9ebec0');
    ctx.fillStyle=sea;ctx.fillRect(0,0,width,height);
    function trace(points){
      let pen=false;ctx.beginPath();
      for(const p of points){
        const [x,y,z]=project(p);
        if(z<0){pen=false;continue;}
        if(!pen)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        pen=true;
      }
    }
    ctx.lineWidth=1;ctx.strokeStyle='#dce5d356';
    for(let x=-180;x<180;x+=10){trace(Array.from({length:91},(_,i)=>[x,-90+i*2]));ctx.stroke();}
    for(let y=-80;y<=80;y+=10){trace(Array.from({length:181},(_,i)=>[-180+i*2,y]));ctx.stroke();}
    for(const poly of world){
      let visible=false;ctx.beginPath();
      for(let i=0;i<poly.length;i++){
        const [x,y,z]=project(poly[i]);
        if(z>=0)visible=true;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      if(!visible)continue;
      ctx.closePath();ctx.fillStyle='#e5dfbf';ctx.strokeStyle='#b8ad8b';ctx.lineWidth=.8;ctx.fill();ctx.stroke();
    }
    for(const line of lines){
      trace(line.coords);ctx.strokeStyle=line.color;ctx.lineWidth=line.emphasis?4:2.5;ctx.setLineDash(line.estimated?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);
    }
    hit=[];
    const cluster=scale<10;
    const groups=[];
    for(const p of pins){
      const [x,y,z]=project(p.coords);if(z<0||x<0||x>width||y<0||y>height)continue;
      const target=cluster&&p.id!==picked&&groups.find(g=>g.p.id!==picked&&Math.hypot(g.x-x,g.y-y)<19);
      if(target)target.items.push(p);else groups.push({x,y,p,items:[p]});
    }
    for(const g of groups){
      const p=g.p,active=p.id===picked,many=g.items.length>1,r=active?10:many?11:p.saved?7.2:5.4;
      ctx.beginPath();ctx.arc(g.x,g.y,r,0,Math.PI*2);ctx.fillStyle=many?'#75503f':categories[p.cat][1];ctx.fill();
      ctx.lineWidth=active?2.6:1.4;ctx.strokeStyle='#fff8e9';ctx.stroke();
      if(many){ctx.textAlign='center';ctx.font='bold 10px sans-serif';ctx.fillStyle='#fff';ctx.fillText(g.items.length,g.x,g.y+3.5);}
      hit.push({...g,r:Math.max(11,r)});
    }
    ctx.restore();
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function sizes(){const box=canvas.parentElement.getBoundingClientRect();width=box.width;height=box.height;map?.resize();schedule();}
  new ResizeObserver(sizes).observe(canvas.parentElement);
  fetch('/world.json').then(r=>r.json()).then(w=>{world=w;schedule();}).catch(()=>{});
  function sources(){
    if(!libraryReady())return;
    map.getSource('poi')?.setData(collection(pins.filter(p=>p.id!==picked).map(p=>({type:'Feature',properties:{id:p.id,color:categories[p.cat][1],saved:p.saved?1:0,picked:p.id===picked?1:0},geometry:{type:'Point',coordinates:p.coords}}))));
    const active=pins.find(p=>p.id===picked);
    map.getSource('selected-poi')?.setData(collection(active?[{type:'Feature',properties:{id:active.id,color:categories[active.cat][1]},geometry:{type:'Point',coordinates:active.coords}}]:[]));
    map.getSource('journey')?.setData(collection(lines.map(l=>({type:'Feature',properties:{color:l.color,estimated:l.estimated?1:0,weight:l.emphasis?5:3},geometry:{type:'LineString',coordinates:l.coords}}))));
  }
  let metroQuery=null, metroKey='', metroData=null, metroTimer;
  function showMetro(){
    if(!map?.getSource('metro-network'))return;
    map.getSource('metro-network').setData(transit&&metroData?metroData:collection([]));
    const hasLines=metroData?.features.some(f=>f.geometry.type!=='Point');
    const hasStations=metroData?.features.some(f=>f.geometry.type==='Point');
    for(const [id,hasData] of [['metro-lines',hasLines],['metro-entrances',hasStations]])
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',transit&&!hasData?'visible':'none');
  }
  function refreshMetro(){
    clearTimeout(metroTimer);
    if(!transit||!libraryReady()||rotating)return;
    if(map.getZoom()<10.5){
      metroQuery?.abort();metroKey='';metroData=null;showMetro();
      status.textContent='公共交通 · 放大到城市级别查看';
      return;
    }
    metroTimer=setTimeout(async()=>{
      const b=map.getBounds();
      const west=Math.max(-180,Math.floor(b.getWest()*8)/8),east=Math.min(180,Math.ceil(b.getEast()*8)/8);
      const south=Math.max(-85,Math.floor(b.getSouth()*8)/8),north=Math.min(85,Math.ceil(b.getNorth()*8)/8);
      if(east<=west||north<=south||east-west>1.5||north-south>1){status.textContent='公共交通 · 请继续放大';return;}
      const key=new URLSearchParams({south,west,north,east}).toString();
      if(key===metroKey){showMetro();return;}
      metroQuery?.abort();metroKey=key;metroData=null;showMetro();
      const controller=new AbortController();metroQuery=controller;
      status.textContent='正在读取地铁线路…';
      try{
        const r=await fetch('/api/metro?'+key,{signal:controller.signal});
        if(!r.ok)throw Error();
        const data=await r.json();
        if(controller.signal.aborted||!transit)return;
        metroData=data;showMetro();
        status.textContent=data.features.length?'地铁线路 · © OpenStreetMap':'当前范围没有线路资料 · 显示底图轨道与入口';
      }catch{
        if(controller.signal.aborted)return;
        metroKey='';
        status.textContent='线路资料暂不可用 · 显示底图轨道与入口';
      }
    },350);
  }
  function finishStyle(){
    if(!map||map.getSource('poi'))return;
    try{map.setProjection({type:'globe'});}catch{}
    map.addSource('journey',{type:'geojson',data:collection([])});
    for(const [id,flag] of [['journey-real',0],['journey-estimate',1]])map.addLayer({id,type:'line',source:'journey',filter:['==',['get','estimated'],flag],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['get','weight'],...(flag?{'line-dasharray':[2,2]}:{})}});
    map.addSource('poi',{type:'geojson',cluster:true,clusterRadius:34,clusterMaxZoom:10,data:collection([])});
    map.addLayer({id:'clusters',type:'circle',source:'poi',filter:['has','point_count'],paint:{'circle-color':'#79503d','circle-radius':['step',['get','point_count'],13,10,16],'circle-stroke-color':'#fff4e8','circle-stroke-width':1.5}});
    map.addLayer({id:'cluster-count',type:'symbol',source:'poi',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#fff'}});
    map.addLayer({id:'places',type:'circle',source:'poi',filter:['!',['has','point_count']],paint:{'circle-color':['get','color'],'circle-radius':['case',['==',['get','picked'],1],10,['==',['get','saved'],1],8,6],'circle-stroke-color':'#fff9ec','circle-stroke-width':['case',['==',['get','picked'],1],3,1.4]}});
    map.addSource('selected-poi',{type:'geojson',data:collection([])});
    map.addLayer({id:'selected-place',type:'circle',source:'selected-poi',paint:{'circle-color':['get','color'],'circle-radius':11,'circle-stroke-color':'#fff9ec','circle-stroke-width':3}});
    map.addSource('metro-network',{type:'geojson',data:collection([]),attribution:'© OpenStreetMap contributors'});
    const metroLine={source:'metro-network',filter:['==',['geometry-type'],'LineString'],minzoom:10.5};
    map.addLayer({id:'metro-network-lines',...metroLine,type:'line',paint:{'line-color':['get','color'],'line-width':3}},'places');
    map.addLayer({id:'metro-network-names',...metroLine,type:'symbol',minzoom:11,layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#174f59','text-halo-color':'#fff9ee','text-halo-width':1.4}});
    const metroStation={source:'metro-network',filter:['==',['geometry-type'],'Point'],minzoom:11};
    map.addLayer({id:'metro-stations',...metroStation,type:'circle',paint:{'circle-radius':3.5,'circle-color':'#fff9ee','circle-stroke-color':'#116975','circle-stroke-width':1.5}});
    map.addLayer({id:'metro-station-names',...metroStation,type:'symbol',minzoom:13,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11,'text-offset':[0,0.8],'text-anchor':'top'},paint:{'text-color':'#174f59','text-halo-color':'#fff9ee','text-halo-width':1.3}});
    loaded=true;refreshLayer();sources();showMetro();refreshMetro();
    if(pendingFit)fit(pendingFit);
    if(viewPlace)focus(viewPlace);
  }
  const styleOrigin=location.origin;
  const vectorLayer=(id,type,sourceLayer,paint,extra={})=>({id,type,source:'osm','source-layer':sourceLayer,paint,...extra});
  const metroFallback=[
    vectorLayer('metro-lines','line','transportation',{'line-color':'#317b82','line-width':2.3,'line-dasharray':[3,1.4]},{minzoom:10,filter:['==',['get','subclass'],'subway'],layout:{visibility:'none'}}),
    vectorLayer('metro-entrances','circle','poi',{'circle-radius':3,'circle-color':'#d5f4ef','circle-stroke-color':'#317b82','circle-stroke-width':1},{minzoom:12,filter:['==',['get','subclass'],'subway_entrance'],layout:{visibility:'none'}})
  ];
  const streetStyle={version:8,glyphs:styleOrigin+'/basemap/fonts/{fontstack}/{range}.pbf',sources:{
    osm:{type:'vector',url:styleOrigin+'/basemap/planet'},
    relief:{type:'raster',tiles:[styleOrigin+'/basemap/natural_earth/ne2sr/{z}/{x}/{y}.png'],tileSize:256,maxzoom:6,attribution:'Natural Earth'}
  },layers:[
    {id:'ground',type:'background',paint:{'background-color':'#eee8d6'}},
    {id:'relief',type:'raster',source:'relief',maxzoom:8,paint:{'raster-opacity':.55}},
    vectorLayer('grass','fill','landcover',{'fill-color':'#d4dfbe','fill-opacity':.57},{minzoom:7}),
    vectorLayer('parks','fill','park',{'fill-color':'#c7d9b1','fill-opacity':.62},{minzoom:8}),
    vectorLayer('water','fill','water',{'fill-color':'#acc9cb'}),
    vectorLayer('streams','line','waterway',{'line-color':'#a2c3c6','line-width':1.15},{minzoom:9}),
    vectorLayer('borders','line','boundary',{'line-color':'#ab9a84','line-width':1,'line-dasharray':[3,2]},{filter:['==',['get','admin_level'],2]}),
    vectorLayer('regional-borders','line','boundary',{'line-color':'#9c826d','line-width':1.1,'line-dasharray':[2,2]},{minzoom:3.5,filter:['all',['>=',['get','admin_level'],3],['<=',['get','admin_level'],4],['!=',['get','maritime'],1]]}),
    ...metroFallback,
    vectorLayer('houses','fill','building',{'fill-color':'#d4bcaa','fill-opacity':.68},{minzoom:14}),
    vectorLayer('roads-casing','line','transportation',{'line-color':'#cbb398','line-width':['interpolate',['linear'],['zoom'],5,1.1,13,3.5,18,13]},{minzoom:5,filter:['match',['get','class'],['motorway','trunk','primary'],true,false],layout:{'line-join':'round','line-cap':'round'}}),
    vectorLayer('roads-primary','line','transportation',{'line-color':'#fff4d9','line-width':['interpolate',['linear'],['zoom'],5,.55,13,2.4,18,11]},{minzoom:5,filter:['match',['get','class'],['motorway','trunk','primary'],true,false],layout:{'line-join':'round','line-cap':'round'}}),
    vectorLayer('roads-local','line','transportation',{'line-color':'#fffaf0','line-width':['interpolate',['linear'],['zoom'],9,.5,14,2.1,18,8]},{minzoom:9,filter:['match',['get','class'],['motorway','trunk','primary','rail'],false,true],layout:{'line-join':'round','line-cap':'round'}}),
    vectorLayer('place-names','symbol','place',{'text-color':'#5b4a39','text-halo-color':'#fff8e7','text-halo-width':1.1},{layout:{'text-field':['coalesce',['get','name:zh'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],3,10,11,13,17,16],'symbol-sort-key':['coalesce',['get','rank'],99]}}),
    vectorLayer('street-names','symbol','transportation_name',{'text-color':'#755f4b','text-halo-color':'#fff8e7','text-halo-width':1},{minzoom:12,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11,'symbol-placement':'line'}})
  ]};
  function satStyle(){
    return {version:8,glyphs:location.origin+'/basemap/fonts/{fontstack}/{range}.pbf',sources:{osm:{type:'vector',url:styleOrigin+'/basemap/planet'},sat:{type:'raster',tiles:token?['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token='+encodeURIComponent(token)]:[location.origin+'/imagery/{z}/{y}/{x}.jpeg'],tileSize:256,maxzoom:token?19:8,attribution:token?'© Mapbox':'NASA EOSDIS GIBS · Blue Marble'},...(token?{relief:{type:'raster-dem',tiles:['https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token='+encodeURIComponent(token)],tileSize:256,maxzoom:14,encoding:'mapbox'}}:{})},...(token?{terrain:{source:'relief',exaggeration:1.15}}:{}),layers:[{id:'background',type:'background',paint:{'background-color':'#9cbabc'}},{id:'satellite',type:'raster',source:'sat'},...metroFallback]};
  }
  function refreshLayer(){
    const active=libraryReady();
    street.classList.toggle('visible',active);canvas.hidden=active;
    status.textContent=active?(layer==='satellite'&&!token?'NASA 卫星概览':'拖动地图 · 双指缩放'):(gpuUnavailable?'地球简图 · 当前浏览器无法启用 3D 街道渲染':'地球简图 · 街道底图连接中');
    credit.hidden=active;
    document.querySelectorAll('[data-layer]').forEach(b=>b.classList.toggle('chosen',b.dataset.layer===layer));
    schedule();
  }
  function createMap(){
    if(!window.maplibregl)return;
    try{
      map=new maplibregl.Map({container:street,style:layer==='satellite'?satStyle():streetStyle,center:[lon,lat],zoom:scale<2?0.85:4.55,maxPitch:66,attributionControl:{compact:true},renderWorldCopies:false});
      map.on('style.load',finishStyle);
      map.on('moveend',refreshMetro);
      for(const event of ['mousedown','touchstart','wheel','keydown'])street.addEventListener(event,stopRotation,{passive:true});

      map.on('error',e=>{
        if(!loaded&&e.error)status.textContent='地球简图 · 当前底图连接失败';
      });
      map.on('click',async e=>{
        if(pickPoint){const callback=pickPoint;pickPoint=null;callback([e.lngLat.wrap().lng,e.lngLat.lat]);return;}
        if(!map.getLayer('places'))return;
        const pt=e.point, found=map.queryRenderedFeatures([[pt.x-8,pt.y-8],[pt.x+8,pt.y+8]],{layers:['selected-place','places','clusters']})[0];
        if(!found)return;
        if(found.layer.id!=='clusters')onPlace(String(found.properties.id));
        else{
          const zoom=await map.getSource('poi').getClusterExpansionZoom(found.properties.cluster_id).catch(()=>map.getZoom()+1);
          map.easeTo({center:found.geometry.coordinates,zoom});
        }
      });
      map.on('mousemove',e=>{if(map.getLayer('places'))map.getCanvas().style.cursor=map.queryRenderedFeatures(e.point,{layers:['selected-place','places','clusters']}).length?'pointer':'';});
    }catch{map=null;gpuUnavailable=true;refreshLayer();}
  }
  const loader=document.createElement('script');loader.src='/vendor/maplibre-gl.js';loader.onload=createMap;
  loader.onerror=()=>{status.textContent='地球简图 · 街道底图暂不可用';};
  document.head.append(loader);
  setTimeout(()=>{if(!gpuUnavailable&&!libraryReady())status.textContent='地球简图 · 街道底图暂不可用';},8500);
  fetch('/api/config').then(r=>r.json()).then(c=>{token=c.mapToken;if(token&&map&&layer==='satellite'){loaded=false;map.setStyle(satStyle(),{diff:false});}}).catch(()=>{});
  function switchLayer(next){
    if(next===layer)return;
    layer=next;
    if(map){loaded=false;map.setStyle(next==='satellite'?satStyle():streetStyle,{diff:false});}
    if(!map&&next==='satellite')onNotice('卫星底图需要在线加载');
    refreshLayer();
  }
  function focus(p){
    stopRotation();pendingFit=null;
    viewPlace=p;picked=p.id;
    if(libraryReady())map.flyTo({center:p.coords,zoom:Math.max(9,map.getZoom()),speed:1.25});
    else{[lon,lat]=p.coords;scale=Math.max(scale,9);}
    sources();schedule();
  }
  function reset(global=false){
    stopRotation();pendingFit=null;
    viewPlace=null;
    if(global){lon=-8;lat=35;scale=1.07;if(map)map.jumpTo({center:[lon,lat],zoom:.85,pitch:0,bearing:0});}
    else{lon=-4;lat=40;scale=6.1;if(libraryReady())map.flyTo({center:[-4,40],zoom:4.55,pitch:0,bearing:0});}
    schedule();
  }
  function zoom(factor){
    stopRotation();
    if(libraryReady())map.easeTo({zoom:map.getZoom()+Math.log2(factor)});
    else{scale=Math.max(.6,Math.min(155,scale*factor));schedule();}
  }
  function fit(points){
    if(!points.length)return;
    stopRotation();
    pendingFit=libraryReady()?null:points;
    const ordered=points.map(p=>(p[0]+360)%360).sort((a,b)=>a-b);
    const gaps=ordered.map((x,i)=>(ordered[(i+1)%ordered.length]+(i===ordered.length-1?360:0))-x);
    const cut=ordered[(gaps.indexOf(Math.max(...gaps))+1)%ordered.length];
    const xs=ordered.map(x=>(x-cut+360)%360+cut-(cut>180?360:0)),ys=points.map(p=>p[1]),a=Math.min(...xs),b=Math.max(...xs),c=Math.min(...ys),d=Math.max(...ys);
    viewPlace=null;
    if(libraryReady())map.fitBounds([[a,c],[b,d]],{padding:{top:100,right:65,bottom:width<720?height*.36:65,left:65},maxZoom:10,duration:700});
    else{lon=(a+b)/2;lat=(c+d)/2;scale=Math.min(35,Math.max(2.5,75/Math.max(b-a,(d-c)*1.35,2)));schedule();}
  }
  const fingers=new Map();
  let moved=false;
  canvas.addEventListener('pointerdown',e=>{stopRotation();canvas.setPointerCapture(e.pointerId);fingers.set(e.pointerId,[e.offsetX,e.offsetY]);if(fingers.size===1)moved=false;else moved=true;});
  canvas.addEventListener('pointermove',e=>{
    const prev=fingers.get(e.pointerId);if(!prev)return;
    const xy=[e.offsetX,e.offsetY],dx=xy[0]-prev[0],dy=xy[1]-prev[1];
    if(fingers.size>1){
      const other=[...fingers].find(([id])=>id!==e.pointerId)[1];
      zoom(Math.hypot(xy[0]-other[0],xy[1]-other[1])/Math.max(2,Math.hypot(prev[0]-other[0],prev[1]-other[1])));
    }else{
      if(Math.abs(dx)+Math.abs(dy)>1)moved=true;
      lon=(lon-dx*135/(Math.min(width,height)*scale)+540)%360-180;
      lat=Math.max(-84,Math.min(84,lat+dy*135/(Math.min(width,height)*scale)));
    }
    fingers.set(e.pointerId,xy);schedule();
  });
  canvas.addEventListener('pointerup',e=>{
    fingers.delete(e.pointerId);if(moved||fingers.size)return;
    if(pickPoint){
      const radius=Math.min(width,height)*.42*scale;
      const x=(e.offsetX-width*.5)/radius,y=(height*(width<720?.34:.52)-e.offsetY)/radius;
      if(x*x+y*y>1)return;
      const z=Math.sqrt(1-x*x-y*y),phi=lat*rad;
      const longitude=lon+Math.atan2(x,z*Math.cos(phi)-y*Math.sin(phi))/rad;
      const latitude=Math.asin(y*Math.cos(phi)+z*Math.sin(phi))/rad;
      const callback=pickPoint;pickPoint=null;callback([(longitude+540)%360-180,latitude]);return;
    }
    const g=[...hit].reverse().find(g=>Math.hypot(e.offsetX-g.x,e.offsetY-g.y)<g.r);
    if(g?.items.length>1){[lon,lat]=g.p.coords;zoom(1.85);}
    else if(g)onPlace(g.p.id);
  });
  canvas.addEventListener('pointercancel',e=>fingers.delete(e.pointerId));
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.002));},{passive:false});
  canvas.addEventListener('dblclick',()=>zoom(1.5));
  document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{stopRotation();switchLayer(b.dataset.layer);});
  document.querySelector('#resetMap').onclick=()=>reset();
  document.querySelector('#worldMap').onclick=()=>reset(true);
  document.querySelector('#zoomIn').onclick=()=>zoom(1.45);
  document.querySelector('#zoomOut').onclick=()=>zoom(1/1.45);
  document.addEventListener('visibilitychange',()=>{lastSpin=0;if(rotating)schedule();});
  return {focus,fit,
    world(spin){pickPoint=null;switchLayer('street');reset(true);rotating=spin&&!matchMedia('(prefers-reduced-motion: reduce)').matches;lastSpin=0;schedule();},
    showProject(points){pickPoint=null;stopRotation();switchLayer('street');if(points.length)fit(points);else reset(true);},
    transit(on){
      transit=on;
      if(!on){clearTimeout(metroTimer);metroQuery?.abort();metroKey='';metroData=null;refreshLayer();}
      showMetro();refreshMetro();
    },
    pick(callback){stopRotation();pickPoint=callback;},
    set(nextPins,nextLines,selected){pins=nextPins;lines=nextLines;picked=selected;sources();schedule();}};
}
