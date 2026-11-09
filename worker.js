const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const mime={'/':'text/html; charset=utf-8','/style.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/map.js':'text/javascript; charset=utf-8','/places.js':'text/javascript; charset=utf-8','/world.json':'application/json','/vendor/maplibre-gl.js':'text/javascript; charset=utf-8','/vendor/maplibre-gl.css':'text/css; charset=utf-8','/vendor/maplibre-license.txt':'text/plain; charset=utf-8'};
async function serveMap(path,origin){
  const street=path.startsWith('/basemap/');
  const suffix=path.slice(street?'/basemap'.length:'/imagery'.length);
  const allowed=street?/^\/(?:planet(?:\/.*)?|sprites\/.*|fonts\/.*|natural_earth\/.*)$/:/^\/\d+\/\d+\/\d+\.jpeg$/;
  if(!allowed.test(suffix))return new Response(null,{status:404});
  const upstream=street?'https://tiles.openfreemap.org'+suffix:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-01-01/GoogleMapsCompatible_Level8'+suffix;
  try{
    const r=await fetch(upstream,{signal:AbortSignal.timeout(8000),cf:{cacheEverything:true,cacheTtl:3600}});
    if(!r.ok)return new Response(null,{status:r.status});
    const type=r.headers.get('Content-Type')||'application/octet-stream';
    const headers={'Content-Type':type,'Cache-Control':'public, max-age=3600'};
    if(street&&type.includes('json')){
      const source=(await r.text()).replaceAll('https://tiles.openfreemap.org',origin+'/basemap');
      return new Response(source,{headers});
    }
    return new Response(r.body,{headers});
  }catch{return new Response(null,{status:503});}
}
const privateHeaders = {'Cache-Control':'private, no-store','Vary':'Authorization'};
async function matchesPassword(authorization,password){
  if(!authorization?.startsWith('Basic '))return false;
  let supplied;
  try{supplied=atob(authorization.slice(6));}catch{return false;}
  const encode=new TextEncoder();
  const [actual,expected]=await Promise.all([supplied,'tao:'+password].map(
    value=>crypto.subtle.digest('SHA-256',encode.encode(value))
  ));
  const a=new Uint8Array(actual),b=new Uint8Array(expected);
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}

export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    const password=env.ROADBOOK_PASSWORD;
    if(typeof password!=='string'||! /^[!-~]{16,}$/.test(password)){
      return new Response('Set the ROADBOOK_PASSWORD Worker secret to at least 16 printable ASCII characters.',{status:503,headers:privateHeaders});
    }
    if(!await matchesPassword(request.headers.get('Authorization'),password)){
      return new Response('Private roadbook',{status:401,headers:{...privateHeaders,'WWW-Authenticate':'Basic realm="Iberia Roadbook", charset="UTF-8"'}});
    }
    const user='owner';
    if(request.method==='GET'&&(path.startsWith('/basemap/')||path.startsWith('/imagery/')))return serveMap(path,url.origin);
    if(path==='/api/config')return json({mapToken:env.MAPBOX_PUBLIC_TOKEN?.startsWith('pk.')?env.MAPBOX_PUBLIC_TOKEN:null});
    if(path==='/api/state'){
      if(!env.DB)return json({error:'云端存档暂不可用'},503);
      try{
        if(request.method==='GET'){
          const row=await env.DB.prepare('SELECT state FROM roadbook WHERE user_id = ?').bind(user).first();
          return json({state:row?JSON.parse(row.state):null});
        }
        if(request.method==='PUT'){
          if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
          const state=await request.text();
          if(state.length>800000)return json({error:'存档过大'},413);
          JSON.parse(state);
          await env.DB.prepare('INSERT INTO roadbook (user_id,state,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').bind(user,state,Date.now()).run();
          return json({ok:true});
        }
        return json({error:'方法不支持'},405);
      }catch{return json({error:'云端存档暂不可用'},503);}
    }
    if(path==='/api/plan'&&request.method==='POST'){
      if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
      try{
        const raw=await request.text();
        if(raw.length>45000)return json({error:'请求过大'},413);
        const body=JSON.parse(raw);
        return json(await planTrips(body,env.MAPBOX_ROUTING_TOKEN,url.origin));
      }catch{return json({error:'排程失败，请重试'},400);}
    }
    if(path==='/api/walk'&&request.method==='POST'){
      if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
      try{
        const body=await request.json(),allowed=body.coords;
        if(!Array.isArray(allowed)||allowed.length!==2||!allowed.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=-14&&p[0]<=6&&p[1]>=34&&p[1]<=45))return json({error:'坐标有误'},400);
        const r=await providerRequest('walking','route',allowed,env.MAPBOX_ROUTING_TOKEN,{steps:'false',overview:'full',geometries:'geojson'},url.origin);
        const route=r.routes?.[0];
        return route?json({road:route.geometry.coordinates,minutes:Math.round(route.duration/60),km:Math.round(route.distance/100)/10}):json({error:'找不到步行路线'},404);
      }catch{return json({error:'步行服务暂不可用'},503);}
    }
    if(Object.hasOwn(assets,path))return new Response(assets[path],{headers:{'Content-Type':mime[path],'Cache-Control':path==='/'?'private, no-cache':'private, max-age=300','Vary':'Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    return new Response('Not found',{status:404});
  }
};
