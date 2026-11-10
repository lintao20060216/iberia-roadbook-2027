// Public OSM metro data, bounded to a city viewport and shared across visitors.
async function loadMetro(url,ctx){
  const names=['south','west','north','east'];
  if(!names.every(name=>url.searchParams.has(name)))return json({error:'缺少地图范围'},400);
  const box=names.map(name=>Number(url.searchParams.get(name)));
  const [s,w,n,e]=box;
  if(!box.every(Number.isFinite)||s<-85||n>85||w<-180||e>180||s>=n||w>=e||n-s>1.01||e-w>1.51)
    return json({error:'请放大到城市级别'},400);
  const rounded=box.map((v,i)=>Number(((i<2?Math.floor(v*8):Math.ceil(v*8))/8).toFixed(3)));
  const bounds=rounded.join(',');
  const key=new Request(url.origin+'/api/metro?cell='+bounds);
  const cache=globalThis.caches?.default;
  const cached=await cache?.match(key);
  if(cached)return cached;
  const query='[out:json][timeout:12];relation["type"="route"]["route"="subway"]('+bounds+')->.lines;'
    +'(.lines;node["railway"~"^(station|halt)$"]["station"="subway"]('+bounds+');'
    +'node["railway"~"^(station|halt)$"]["subway"="yes"]('+bounds+'););out geom('+bounds+');';
  try{
    let r;
    for(const host of ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']){
      const upstream=new URL(host);
      upstream.searchParams.set('data',query);
      try{r=await fetch(upstream,{signal:AbortSignal.timeout(14000),headers:{'User-Agent':'Global Travel Planner / OSM metro layer ('+url.origin+')'}});
        if(r.ok)break;
        if(r.status===429)return json({error:'地铁资料服务繁忙'},503);
      }catch{}
    }
    if(!r?.ok)return json({error:'地铁资料服务暂时不可用'},502);
    const raw=await r.text();
    if(raw.length>4000000)return json({error:'该地区资料较多，请继续放大'},413);
    const result=JSON.parse(raw);
    if(result.remark)return json({error:'地铁资料未完整返回，请放大或稍后重试'},502);
    const features=[];
    const inside=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=rounded[0]&&lat<=rounded[2]&&lon>=rounded[1]&&lon<=rounded[3];
    const add=(type,coordinates,properties)=>features.push({type:'Feature',geometry:{type,coordinates},properties});
    const stations=new Set();
    function station(id,lat,lon,name){
      if(stations.has(id)||!inside(lat,lon))return;
      stations.add(id);add('Point',[lon,lat],{name:String(name||'').slice(0,120)});
    }
    for(const el of result.elements||[]){
      if(el.type==='node'){station(el.id,el.lat,el.lon,el.tags?.name);continue;}
      const props={name:String(el.tags?.ref||el.tags?.name||'').slice(0,120),color:/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(el.tags?.colour||'')?el.tags.colour:'#167d83'};
      const parts=[];
      for(const m of el.members||[]){
        if(m.type==='node'&&/^stop(?:_|$)/.test(m.role||''))station(m.ref,m.lat,m.lon,'');
        if(m.type!=='way'||/^(platform|stop)/.test(m.role||''))continue;
        let part=[];
        for(const point of m.geometry||[]){
          if(Number.isFinite(point?.lat)&&Number.isFinite(point?.lon))part.push([point.lon,point.lat]);
          else{if(part.length>1)parts.push(part);part=[];}
        }
        if(part.length>1)parts.push(part);
      }
      if(parts.length)add('MultiLineString',parts,props);
    }
    const response=Response.json({type:'FeatureCollection',features},{headers:{'Cache-Control':'public, max-age=21600'}});
    if(cache&&ctx?.waitUntil)ctx.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
    return response;
  }catch{return json({error:'地铁资料服务超时或不可用'},502);}
}
