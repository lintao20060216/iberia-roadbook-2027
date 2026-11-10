const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
const mime={'/auto-plan.mjs':'text/javascript; charset=utf-8','/region-catalog.mjs':'text/javascript; charset=utf-8','/workspace.mjs':'text/javascript; charset=utf-8','/workspace-model.mjs':'text/javascript; charset=utf-8','/workspace-regions.mjs':'text/javascript; charset=utf-8','/workspace.css':'text/css; charset=utf-8','/':'text/html; charset=utf-8','/style.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/map.js':'text/javascript; charset=utf-8','/places.js':'text/javascript; charset=utf-8','/world.json':'application/json','/vendor/maplibre-gl.js':'text/javascript; charset=utf-8','/vendor/maplibre-gl.css':'text/css; charset=utf-8','/vendor/maplibre-license.txt':'text/plain; charset=utf-8'};
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
const privateHeaders={'Cache-Control':'private, no-store'};
async function checkOwner(ctx,env){
  const owner=env.ROADBOOK_OWNER_EMAIL?.trim().toLowerCase();
  if(!owner||!ctx?.access)return false;
  const identity=await ctx.access.getIdentity();
  return identity?.email?.trim().toLowerCase()===owner;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const privatePage=url.pathname==='/account'||url.pathname.startsWith('/account/');
    const path=privatePage?url.pathname.slice('/account'.length)||'/':url.pathname;
    if(privatePage){
      if(!env.ROADBOOK_OWNER_EMAIL?.trim()){
        return new Response('Set the ROADBOOK_OWNER_EMAIL Worker secret and enable Cloudflare Access for /account.',{status:503,headers:privateHeaders});
      }
      try{
        if(!await checkOwner(ctx,env)){
          return new Response('Email sign-in required. Cloudflare Access must protect /account.',{status:403,headers:privateHeaders});
        }
      }catch{
        return new Response('Email sign-in temporarily unavailable.',{status:503,headers:privateHeaders});
      }
      if(url.pathname==='/account')return new Response(null,{status:302,headers:{...privateHeaders,Location:'/account/'}});
    }
    if(request.method==='GET'&&(path.startsWith('/basemap/')||path.startsWith('/imagery/')))return serveMap(path,url.origin);
    if(!privatePage&&['/places.js','/api/plan'].includes(path))return new Response('Not found',{status:404,headers:privateHeaders});
    if(path==='/api/metro'&&request.method==='GET')return loadMetro(url,ctx);
    if(path==='/api/config')return json({mapToken:env.MAPBOX_PUBLIC_TOKEN?.startsWith('pk.')?env.MAPBOX_PUBLIC_TOKEN:null});
    if(path==='/api/state'){
      if(!privatePage)return json({error:'请先使用邮箱登录'},401);
      const user='owner';
      if(!env.DB)return json({error:'云端存档暂不可用'},503);
      try{
        if(request.method==='GET'){
          const row=await env.DB.prepare('SELECT state FROM roadbook WHERE user_id = ?').bind(user).first();
          return json({state:row?JSON.parse(row.state):null},200,{ETag:await stateTag(row?.state)});
        }
        if(request.method==='PUT'){
          if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
          const state=await request.text();
          if(state.length>800000)return json({error:'存档过大'},413);
          const parsed=JSON.parse(state);
          if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return json({error:'存档格式不正确'},400);
          const existing=await env.DB.prepare('SELECT state FROM roadbook WHERE user_id = ?').bind(user).first();
          const tag=request.headers.get('If-Match');
          if((parsed.workspace||existing?.state.includes('"workspace"'))&&!tag)return json({error:'请刷新以取得最新存档'},428);
          if(tag&&tag!==await stateTag(existing?.state))return json({error:'存档已被修改'},412);
          const result=existing
            ? await env.DB.prepare('UPDATE roadbook SET state=?,updated_at=? WHERE user_id=? AND state=?').bind(state,Date.now(),user,existing.state).run()
            : await env.DB.prepare('INSERT INTO roadbook (user_id,state,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(user,state,Date.now()).run();
          if(!result.meta?.changes)return json({error:'存档已被修改'},412);
          return json({ok:true},200,{ETag:await stateTag(state)});
        }
        return json({error:'方法不支持'},405);
      }catch{return json({error:'云端存档暂不可用'},503);}
    }
    if(['/api/workspace/drive','/api/workspace/ai','/api/workspace/auto-distances'].includes(path)){
      if(!privatePage)return json({error:'请先使用邮箱登录'},401);
      if(request.method!=='POST')return json({error:'方法不支持'},405);
      if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
      return workspaceApi(path,request,env,url.origin);
    }
    if(path==='/api/plan'&&request.method==='POST'){
      if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
      try{
        const raw=await request.text();
        if(raw.length>45000)return json({error:'请求过大'},413);
        const body=JSON.parse(raw);
        return json(await planTrips(body,env.MAPBOX_ROUTING_TOKEN,url.origin,privatePage));
      }catch{return json({error:'排程失败，请重试'},400);}
    }
    if(path==='/api/walk'&&request.method==='POST'){
      if(!privatePage)return json({error:'请先使用邮箱登录'},401);
      if(request.headers.get('Origin')!==url.origin)return json({error:'请求来源不一致'},403);
      try{
        const body=await request.json(),allowed=body.coords;
        if(!Array.isArray(allowed)||allowed.length!==2||!allowed.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=-14&&p[0]<=6&&p[1]>=34&&p[1]<=45))return json({error:'坐标有误'},400);
        const r=await providerRequest('walking','route',allowed,env.MAPBOX_ROUTING_TOKEN,{steps:'false',overview:'full',geometries:'geojson'},url.origin);
        const route=r.routes?.[0];
        return route?json({road:route.geometry.coordinates,minutes:Math.round(route.duration/60),km:Math.round(route.distance/100)/10}):json({error:'找不到步行路线'},404);
      }catch{return json({error:'步行服务暂不可用'},503);}
    }
    const assetPath=privatePage&&path==='/'?'/account/':path;
    if(Object.hasOwn(assets,assetPath))return new Response(assets[assetPath],{headers:{'Content-Type':mime[path],'Cache-Control':privatePage||path==='/'?'private, no-store':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    return new Response('Not found',{status:404});
  }
};