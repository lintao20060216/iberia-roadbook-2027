const $=s=>document.querySelector(s);
const panel=$('#panel'), content=$('#panelContent');
const ownerMode=location.pathname.startsWith('/account/');
const apiPrefix=ownerMode?'/account/api':'/api';
const guestKey='iberia-roadbook-2027-guest-v1';
const accountLink=$('#accountLink');
if(ownerMode){
  accountLink.href='/';
  accountLink.textContent='访客视图';
}
let cloudReady=false;
const statusNames={want:'想去',must:'必去',booked:'已预订'};
const initial={records:{},locks:{},limit:270,allowApprox:false,trip:null,end:'madrid'};
let state=readLocal(), tab='explore', detail=null, query='', category='', country='', dayFilter=null, busy=false, savedStatus=ownerMode?'正在连接私人存档':'访客清单 · 保存在此浏览器', dirty=0, planRevision=0, timer, toastTimer, dragId=null, walkingLine=null, sheetStart=0;
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr=escapeHtml;
const fmtDate=d=>d.slice(5).replace('-','/');
const minutes=m=>m>=60?Math.floor(m/60)+' 小时 '+(m%60?m%60+' 分钟':''):m+' 分钟';
const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const extraPoints=()=>state.trip?.plans?.flatMap(p=>p.extras||[])||[];
function getPlace(id){
  const p=places.find(p=>p.id===id)||anchors[id]||extraPoints().find(p=>p.id===id);
  return p&&state.records[id]?.coords?{...p,coords:state.records[id].coords,approx:false}:p;
}
const saveCount=()=>places.filter(p=>state.records[p.id]?.status).length;
const pickedPlan=()=>state.trip?.plans?.find(p=>p.end===state.end);
const activeRecords=()=>places.filter(p=>state.records[p.id]?.status);
const sectionLink=(label,url)=>'<a class="link" href="'+attr(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label)+' ↗</a>';
function google(p,orig,mode){
  if(!orig)return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.coords.slice().reverse().join(','));
  return 'https://www.google.com/maps/dir/?api=1&origin='+orig.coords.slice().reverse().join(',')+'&destination='+p.coords.slice().reverse().join(',')+'&travelmode='+mode;
}
function apple(p,orig,mode){
  const xy=p.coords.slice().reverse().join(',');
  if(!orig)return 'https://maps.apple.com/?ll='+xy+'&q='+encodeURIComponent(p.local||p.name);
  return 'https://maps.apple.com/?saddr='+orig.coords.slice().reverse().join(',')+'&daddr='+xy+'&dirflg='+({walking:'w',transit:'r',driving:'d'}[mode]||'d');
}
const map=mountMap(openPlace,notice);
function readLocal(){
  if(ownerMode)return structuredClone(initial);
  try{return {...initial,...JSON.parse(localStorage.getItem(guestKey)||'null')}}
  catch{return structuredClone(initial)}
}
function notice(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3400);}
let pendingSave=Promise.resolve();
function persist(){
  if(!ownerMode){
    try{localStorage.setItem(guestKey,JSON.stringify(state));}
    catch{savedStatus='此浏览器无法保存访客清单';}
    return;
  }
  if(!cloudReady)return;
  const revision=++dirty;
  savedStatus='正在同步';
  clearTimeout(timer);
  timer=setTimeout(()=>{
    const snapshot=JSON.stringify(state);
    pendingSave=pendingSave.catch(()=>{}).then(async()=>{
      try{
        const r=await fetch(apiPrefix+'/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot,keepalive:snapshot.length<55000});
        if(!r.ok)throw Error();
        if(revision===dirty)savedStatus='已同步至私人存档';
      }catch{if(revision===dirty)savedStatus='云端同步失败 · 当前修改暂留本页';}
      const label=$('#saveStatus');if(label)label.textContent=savedStatus;
    });
  },420);
}
async function loadState(){
  const nav=$('.top nav');
  nav.inert=true;
  content.textContent='正在加载私人存档…';
  try{
    const r=await fetch(apiPrefix+'/state');
    if(!r.ok)throw Error();
    const data=await r.json();
    if(data.state)state={...initial,...data.state};
    cloudReady=true;
    savedStatus='私人存档已连接';
    render();
  }catch{
    content.innerHTML='<p class="warning">暂时无法加载私人存档。请重新打开邮箱登录。</p><a class="link" href="/account/">重新打开邮箱登录 ↗</a>';
  }finally{
    if(cloudReady)nav.inert=false;
  }
}
function draftChanged(){planRevision++;if(state.trip)state.trip.stale=true;walkingLine=null;persist();}
function record(id,patch){
  state.records={...state.records,[id]:{...state.records[id],...patch}};
  if(patch.status===null&&state.locks[id]){state.locks={...state.locks};delete state.locks[id];}
  draftChanged();render();
}
function toggle(id){const old=state.records[id]?.status;record(id,{status:old?null:'want'});notice(old?'已从清单移除':'已加入我的清单');}
function chooseTab(name){
  tab=name;detail=null;dayFilter=null;walkingLine=null;content.scrollTop=0;panel.scrollTop=0;
  if(innerWidth<=720){panel.classList.remove('collapsed');panel.classList.toggle('expanded',name!=='explore');}
  render();
  if(name==='plan'){
    if(saveCount()&&(!state.trip||state.trip.stale))generate();
    else if(pickedPlan())fitPlan();
  }
}
function openPlace(id){
  const p=getPlace(id);if(!p?.cat)return;
  detail=id;panel.scrollTop=0;
  if(innerWidth<=720){panel.classList.remove('collapsed');panel.classList.add('expanded');}
  render();map.focus(p);
}
function filtered(){
  const q=query.trim().toLowerCase();
  return places.filter(p=>(tab!=='saved'||state.records[p.id]?.status)&&(!category||tab==='saved'||p.cat===category)&&(!country||tab==='saved'||p.country===country)&&(!q||tab==='saved'||(/^#?\d+$/.test(q)?p.id.match(/^\d+/)?.[0]===q.replace('#',''):[p.id,p.name,p.city,p.local,p.region,p.desc].some(v=>String(v).toLowerCase().includes(q)))));
}
function placeCard(original){
  const p=getPlace(original.id), [label,color,icon]=categories[p.cat],s=state.records[p.id]?.status;
  return '<article class="place"><span class="place-icon" style="--cat:'+color+'" title="'+label+'">'+icon+'</span><button class="place-main" data-open="'+p.id+'"><strong>'+escapeHtml(p.name)+'</strong><small>'+escapeHtml(p.city+' · '+p.region+(p.approx?' · 候选区域':'')+(s?' · '+statusNames[s]:''))+'</small></button><button class="heart" data-heart="'+p.id+'" aria-label="'+(s?'移除收藏':'收藏')+'" aria-pressed="'+Boolean(s)+'">'+(s?'♥':'♡')+'</button></article>';
}
function catalogue(){
  const saved=tab==='saved',items=filtered();
  return '<div class="eyebrow">'+(saved?'02 / SAVED PLACES':'01 / FIELD GUIDE')+'</div><h2>'+(saved?'我的清单':'探索地图')+'</h2><p class="intro">'+(saved?'收藏你的候选体验，标记必去，或记录已订的场次。':'从比利牛斯山到大西洋海岸。按兴趣找地方，再把喜欢的加入行程。')+'</p>'+
    (saved?'<button class="primary" data-go="plan">去排路线 →</button>':'<label class="search"><span>⌕</span><input id="query" aria-label="搜索地点" placeholder="搜地点、城市、体验或原清单编号" value="'+attr(query)+'"></label><div class="chips" aria-label="国家">'+[['','全部地区'],['西班牙','西班牙'],['葡萄牙','葡萄牙']].map(([id,label])=>'<button class="chip '+(id===country?'active':'')+'" data-country="'+id+'">'+label+'</button>').join('')+'</div><div class="chips" aria-label="体验类型" style="margin-top:7px">'+[['',['全部体验']],...Object.entries(categories)].map(([id,[label]])=>'<button class="chip '+(id===category?'active':'')+'" data-cat="'+id+'">'+label+'</button>').join('')+'</div>')+
    '<div class="subhead"><span id="resultCount">'+items.length+' 个'+(saved?'已收藏体验':'匹配地点')+'</span><span>'+(saved?'点击卡片更改优先级':'点击图钉或卡片查看')+'</span></div><div id="placeList" class="list">'+(items.length?items.map(placeCard).join(''):'<div class="empty">'+(saved?'还没收藏。到探索地图点击 ♡，再回来挑必去体验。':'没有找到匹配地点。试试城市名或清除筛选。')+'</div>')+'</div><div class="stamp" id="saveStatus">'+savedStatus+'</div>';
}
function detailPage(p){
  const [label,color,icon]=categories[p.cat],r=state.records[p.id]||{},lock=state.locks[p.id]||{};
  const dateOptions=['<option value="">不锁日期</option>',...travelDays.map(d=>'<option '+(lock.date===d?'selected':'')+' value="'+d+'">'+fmtDate(d)+'</option>')].join('');
  const red='https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent(p.name+' '+p.city);
  const peers=places.filter(q=>q.group&&q.group===p.group&&q.id!==p.id);
  return '<button class="back" data-back>← 返回'+(tab==='saved'?'清单':tab==='plan'?'行程':'地图')+'</button><div class="detail-icon" style="--cat:'+color+'">'+icon+'</div><div class="eyebrow">'+escapeHtml(p.country+' / '+p.region+' / '+label)+'</div><h2>'+escapeHtml(p.name)+'</h2><p class="intro">'+escapeHtml(p.local)+' · '+escapeHtml(p.city)+'</p><p class="detail-desc">'+escapeHtml(p.desc)+'</p><div class="info">'+(p.approx?'候选区域 · 集合点待确认':p.kind==='event'?'场次型体验 · 请先确认实际日期和开场时间':p.walk?'步行路线 · 细节以现场为准':'导航参考点 · 出发前核对入口')+'<br>建议预留 '+minutes(p.minutes)+'</div>'+
  '<div class="links">'+sectionLink('Google Maps',google(p))+sectionLink('Apple 地图',apple(p))+sectionLink('小红书搜索',red)+(r.post?sectionLink('小红书原帖',r.post):'')+(p.website?sectionLink('官网 / 旅游信息',p.website):'')+'</div>'+
  (peers.length?'<div class="section"><h3>同一体验的候选地点</h3>'+peers.map(placeCard).join('')+'</div>':'')+
  '<div class="section"><h3>加入我的清单</h3><div class="actions">'+Object.entries(statusNames).map(([id,name])=>'<button class="choice '+(r.status===id?'active':'')+'" data-status="'+id+'">'+name+'</button>').join('')+(r.status?'<button class="secondary" data-status="">移除</button>':'')+'</div>'+
  (r.status?'<div class="inline" style="margin-top:10px"><label class="field">锁定日期<select id="lockDate">'+dateOptions+'</select></label><label class="field">当地开始时间<input id="lockTime" type="time" value="'+attr(lock.time||'')+'"></label></div><button class="secondary" style="margin-top:7px" id="saveLock">保存时段</button>':'')+'</div>'+
  '<div class="section"><h3>补充链接或集合点</h3><label class="field">小红书帖子网址<input id="post" type="url" placeholder="https://www.xiaohongshu.com/…" value="'+attr(r.post||'')+'"></label><div class="inline" style="margin-top:7px"><label class="field">经度<input id="lon" type="number" step="any" placeholder="'+p.coords[0]+'" value="'+attr(r.coords?.[0]??'')+'"></label><label class="field">纬度<input id="lat" type="number" step="any" placeholder="'+p.coords[1]+'" value="'+attr(r.coords?.[1]??'')+'"></label></div><button class="secondary" style="margin-top:7px" id="saveDetail">保存补充信息</button></div>';
}
function planPage(){
  const p=pickedPlan(),trip=state.trip;
  return '<div class="eyebrow">03 / ROAD TRIP PLANNER</div><h2>路线与行程</h2><p class="intro">1 月 26 日抵达休息 · 1 月 27 日起玩 15 天 · 2 月 5 日留出特别安排</p><div class="config"><label class="field">每日自驾上限<select id="limit">'+[120,180,210,240,270,300,360,420,480,540,600].map(m=>'<option value="'+m+'" '+(state.limit===m?'selected':'')+'>'+minutes(m)+'</option>').join('')+'</select></label><label class="field">城内交通<select aria-label="城内交通"><option>步行优先 · 公交外查</option></select></label></div><label class="option"><input type="checkbox" id="approx" '+(state.allowApprox?'checked':'')+'> 允许使用候选区域估排</label><div class="actions"><button class="primary" id="generate" '+(busy?'disabled':'')+'>'+(busy?'正在计算两条路线…':trip?'重新生成两条路线':'生成两条出境路线')+'</button>'+(p?'<button class="secondary" id="print">打印 / PDF</button>':'')+'</div><div class="stamp">已收藏 '+saveCount()+' 项 · <span id="saveStatus">'+savedStatus+'</span></div>'+
  (!p?'<div class="section empty">先收藏你想去的体验。生成后可同时比较马德里与里斯本出境路线，锁定预订并调整日期。</div>':'<div class="section"><h3>两种出境方案</h3><div class="comparison">'+trip.plans.map(x=>'<button class="compare '+(x.end===state.end?'active':'')+'" data-end="'+x.end+'"><b>'+anchors[x.end].name+'出</b><span>'+minutes(x.totalDrive)+' 自驾 · '+x.longDays+' 个长途日</span><span>保留必去 '+x.mustKept+' 项 · 待安排 '+x.excluded.length+' 项</span></button>').join('')+'</div><p class="tiny">路线来源 '+escapeHtml(trip.provider)+' · 各站均用当地时间 · 虚线为估算或未取得道路形状</p>'+(trip.stale?'<p class="warning">清单或设置已更改，请重新生成以更新两个版本。</p>':'')+(!p.exact?'<p class="warning">部分路段使用估算。请在导航应用核对实际道路、交通和时段。</p>':'')+'<button class="secondary" id="allDays">在地图显示全部路线</button></div>'+
    '<div class="section"><h3>逐日行程</h3>'+p.days.map((d,i)=>dayCard(d,i)).join('')+'</div>'+
    '<div class="section"><h3>待安排 '+p.excluded.length+' 项</h3>'+(p.excluded.length?p.excluded.map(e=>'<div class="leg"><button class="secondary" data-open="'+e.id+'">'+escapeHtml(getPlace(e.id)?.name)+'</button> '+escapeHtml(e.why)+'</div>').join(''):'<div class="tiny">当前方案中没有被搁置的项目。</div>')+'</div><div class="stamp"><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">反馈道路数据</a> · <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">OSRM 路由说明</a></div>');
}
function legCard(leg,day,index){
  const a=getPlace(leg.from),b=getPlace(leg.to);
  if(!a||!b)return '';
  const driving=/自驾|道路/.test(leg.mode),walk=leg.mode==='步行估算';
  const mode=driving?'driving':walk?'walking':'transit';
  return '<div class="leg"><span>'+escapeHtml(a.name+' → '+b.name+' · '+leg.mode+' · '+minutes(leg.mins))+'</span>'+sectionLink('Google',google(b,a,mode))+sectionLink('Apple',apple(b,a,mode))+(walk&&ownerMode?'<button class="secondary" data-walk="'+day+':'+index+'">算步行路段</button>':'')+'</div>';
}
function dayWarnings(d){
  return [
    d.over?'驾驶超出上限 '+minutes(d.over):'',
    d.late?'超出可用时段 '+minutes(d.late):'',
    d.clash?'已锁活动时间冲突':''
  ].filter(Boolean).join(' · ');
}
function dayCard(d,i){
  const content=d.activities.length||d.legs.length;
  const stops=d.activities.map(a=>{
    const p=getPlace(a.id);if(!p)return '';
    if(!p.cat)return '<div class="stop"><strong>'+clock(a.start)+' · '+escapeHtml(p.name)+' · 建议中途休息 / 住宿</strong></div>';
    const dates=travelDays.map(date=>'<option '+(date===d.date?'selected':'')+' value="'+date+'">'+fmtDate(date)+'</option>').join('');
    return '<div class="stop" draggable="true" data-drag="'+p.id+'"><button class="place-main" data-open="'+p.id+'"><strong>'+clock(a.start)+' · '+escapeHtml(p.name)+(a.locked?' · 已锁定':'')+'</strong></button><div class="inline"><label class="tiny">移至 <select class="day-select" data-move="'+p.id+'">'+dates+'</select></label><button class="secondary" data-toggle-lock="'+p.id+'" data-date="'+d.date+'" data-time="'+clock(a.start)+'">'+(a.locked?'解锁':'锁定时段')+'</button></div></div>';
  }).join('');
  return '<details class="day" data-day="'+i+'" style="--day:'+d.color+'" '+(dayFilter===i?'open':'')+'><summary><i></i><b>D'+String(i+1).padStart(2,'0')+' · '+fmtDate(d.date)+'</b><small>'+(i===9?'特别安排 · ':i===0?'巴塞罗那 · ':i===14?'出境 · ':'')+(d.drive?minutes(d.drive)+' 自驾':content?d.activities.length+' 项':'留白')+'</small></summary><div class="tiny">'+escapeHtml((getPlace(d.origin)?.city||'')+' → '+(getPlace(d.destination)?.city||''))+'</div>'+(d.over||d.late||d.clash?'<div class="warning">请复核 '+dayWarnings(d)+'</div>':'')+(i===9?'<div class="info">2 月 5 日保留特别安排。可手动锁定指定项目。</div>':'')+stops+d.legs.map((l,j)=>legCard(l,i,j)).join('')+(!content?'<div class="tiny">自由时间，可以用来休息、Citywalk 或补一个候选体验。</div>':'')+'</details>';
}
function drawMap(){
  let points=[],lines=[];
  const p=pickedPlan();
  if(tab==='plan'&&p&&!detail){
    const days=dayFilter===null?p.days:[p.days[dayFilter]];
    const ids=new Set(days.flatMap(d=>d.activities.map(a=>a.id)));
    points=[...ids].map(getPlace).filter(p=>p?.cat);
    lines=days.flatMap(d=>d.legs.map(l=>({coords:l.road||l.coords,color:d.color,estimated:!l.road,emphasis:dayFilter!==null})));
    if(walkingLine)lines.push(walkingLine);
  }else if(detail){
    const p=getPlace(detail);points=[p,...(p.group?places.filter(x=>x.group===p.group&&x.id!==p.id).map(x=>getPlace(x.id)):[])];
    if(p.walk)lines.push({coords:p.walk,color:'#9e5036',estimated:true,emphasis:true});
  }else points=filtered().map(p=>getPlace(p.id));
  map.set(points.map(p=>({...p,saved:!!state.records[p.id]?.status})),lines,detail);
}
function fitPlan(){
  const p=pickedPlan();if(!p)return;
  const days=dayFilter===null?p.days:[p.days[dayFilter]];
  const points=days.flatMap(d=>[...d.legs.flatMap(l=>l.coords),...d.activities.map(a=>getPlace(a.id)?.coords).filter(Boolean)]);
  if(points.length)map.fit(points);
}
function render(){
  const y=panel.scrollTop;
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');});
  $('#savedCount').textContent=saveCount();
  content.innerHTML=detail?detailPage(getPlace(detail)):tab==='plan'?planPage():catalogue();
  panel.scrollTop=y;
  drawMap();
}
async function generate(){
  if(busy)return;
  if(!saveCount()){notice('先收藏至少一个体验');return;}
  const revision=planRevision;
  busy=true;dayFilter=null;walkingLine=null;render();
  try{
    const r=await fetch(apiPrefix+'/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:state.records,locks:state.locks,limit:state.limit,allowApprox:state.allowApprox})});
    const result=await r.json();
    if(!r.ok||!result.plans)throw Error(result.error||'排程失败');
    if(revision!==planRevision)return;
    state.trip=result;persist();
    notice(result.provider==='直线距离估算'?'已生成估算行程':'两种出境方案已生成');
  }catch(e){notice(e.message||'排程失败');}
  finally{
    busy=false;render();
    if(revision!==planRevision&&tab==='plan'&&saveCount())generate();
    else if(tab==='plan')fitPlan();
  }
}
async function walking(value){
  const [i,j]=value.split(':').map(Number),p=pickedPlan(),d=p?.days[i],leg=d?.legs[j];
  if(!leg)return;
  notice('正在计算步行路段');
  try{
    const r=await fetch(apiPrefix+'/walk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({coords:leg.coords})}),data=await r.json();
    if(!r.ok)throw Error(data.error);
    if(p!==pickedPlan())return;
    walkingLine={coords:data.road,color:'#487b67',emphasis:true};
    dayFilter=i;render();map.fit(data.road);
    notice('步行 '+minutes(data.minutes)+' · '+data.km+' 公里');
  }catch(e){notice(e.message||'步行服务暂不可用');}
}
function setLock(id,date,time,run=false){
  state.locks={...state.locks};
  if(date)state.locks[id]={date,time:time||''};else delete state.locks[id];
  draftChanged();render();
  if(run)generate();else notice(date?'已保存当地时间':'已解除日期锁定');
}
function exportPlan(){
  const p=pickedPlan();if(!p)return;
  const days=p.days.map((d,i)=>{
    const title='D'+(i+1)+' · '+fmtDate(d.date)+' · '+(getPlace(d.origin)?.city||'')+' → '+(getPlace(d.destination)?.city||'');
    const warnings=dayWarnings(d);
    const stops=d.activities.map(a=>{
      const place=getPlace(a.id);
      return '<div>'+clock(a.start)+' · '+escapeHtml(place?.name||a.id)+(a.locked?' · 已锁定':'')+
        (place?.website?' · '+sectionLink('官网 / 旅游信息',place.website):'')+'</div>';
    }).join('');
    return '<section class="print-day"><b>'+escapeHtml(title)+'</b>'+
      (i===9?'<div>2 月 5 日特别安排</div>':'')+
      (warnings?'<div class="warning">'+escapeHtml(warnings)+'</div>':'')+
      (d.drive?'<div>'+minutes(d.drive)+' 自驾</div>':'')+
      (stops||(!d.legs.length?'<div>自由时间</div>':''))+
      d.legs.map((leg,j)=>legCard(leg,i,j)).join('')+'</section>';
  }).join('');
  const excluded=p.excluded.map(e=>'<li>'+escapeHtml((getPlace(e.id)?.name||e.id)+' · '+e.why)+'</li>').join('');
  $('#printArea').innerHTML='<h1>全球旅行规划 · 伊比利亚半岛 · '+anchors[p.end].name+'出</h1>'+
    '<p>2027.01.27 — 02.10 · 1 月 26 日抵达后休息 · 各站均用当地时间</p>'+
    '<p>车程来源 '+escapeHtml(state.trip.provider)+(state.trip.stale?' · 行程待重算':'')+
    (!p.exact?' · 部分路段使用估算':'')+'</p>'+days+(excluded?'<h2>待安排</h2><ul>'+excluded+'</ul>':'');
  window.print();
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>chooseTab(b.dataset.tab));
$('#sheetGrip').onclick=()=>{if(panel.classList.contains('expanded')){panel.classList.remove('expanded');panel.classList.add('collapsed');}else{panel.classList.remove('collapsed');panel.classList.add('expanded');}};
$('#sheetGrip').addEventListener('touchstart',e=>{sheetStart=e.touches[0].clientY;},{passive:true});
$('#sheetGrip').addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientY-sheetStart;if(Math.abs(delta)>25){panel.classList.toggle('expanded',delta<0);panel.classList.toggle('collapsed',delta>0);}},{passive:true});
content.addEventListener('input',e=>{
  if(e.target.id!=='query')return;query=e.target.value;const items=filtered();
  $('#resultCount').textContent=items.length+' 个匹配地点';
  $('#placeList').innerHTML=items.length?items.map(placeCard).join(''):'<div class="empty">没有找到匹配地点。试试城市名或清除筛选。</div>';
  drawMap();
});
content.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='limit'){state.limit=Number(t.value);draftChanged();render();}
  if(t.id==='approx'){state.allowApprox=t.checked;draftChanged();render();}
  if(t.dataset.move){const current=state.locks[t.dataset.move];setLock(t.dataset.move,t.value,current?.time,true);}
});
content.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b){
    const summary=e.target.closest('summary');
    if(summary){const n=Number(summary.parentNode.dataset.day);dayFilter=dayFilter===n?null:n;walkingLine=null;requestAnimationFrame(()=>{drawMap();fitPlan();});}
    return;
  }
  if(b.dataset.open){openPlace(b.dataset.open);return;}
  if(b.dataset.heart){toggle(b.dataset.heart);return;}
  if(b.dataset.go){chooseTab(b.dataset.go);return;}
  if('back' in b.dataset){detail=null;render();return;}
  if('cat' in b.dataset){category=b.dataset.cat;render();return;}
  if('country' in b.dataset){country=b.dataset.country;render();return;}
  if('status' in b.dataset){record(detail,{status:b.dataset.status||null});return;}
  if(b.dataset.end){state.end=b.dataset.end;dayFilter=null;walkingLine=null;persist();render();fitPlan();return;}
  if(b.dataset.walk){walking(b.dataset.walk);return;}
  if(b.dataset.toggleLock){const id=b.dataset.toggleLock;setLock(id,state.locks[id]?.date?'':b.dataset.date,b.dataset.time,true);return;}
  if(b.id==='generate'){generate();return;}
  if(b.id==='allDays'){dayFilter=null;walkingLine=null;render();fitPlan();return;}
  if(b.id==='print'){exportPlan();return;}
  if(b.id==='saveLock'){setLock(detail,$('#lockDate').value,$('#lockTime').value);return;}
  if(b.id==='saveDetail'){
    const post=$('#post').value.trim(),lon=$('#lon').value,lat=$('#lat').value;
    if(post){try{const u=new URL(post);if(u.protocol!=='https:'||!['www.xiaohongshu.com','xiaohongshu.com','xhslink.com','www.xhslink.com'].includes(u.hostname))throw Error();}catch{notice('请输入小红书或 xhslink.com 的 HTTPS 链接');return;}}
    let coords=null;
    if(lon||lat){
      const x=Number(lon),y=Number(lat);
      if(!lon||!lat||!Number.isFinite(x)||!Number.isFinite(y)||x<-14||x>6||y<34||y>45){notice('请输入西葡范围内的有效经纬度');return;}
      coords=[x,y];
    }
    const changed=String(state.records[detail]?.coords)!==String(coords);
    state.records={...state.records,[detail]:{...state.records[detail],post,coords}};
    if(changed)draftChanged();else persist();
    render();map.focus(getPlace(detail));notice('地点资料已保存');
  }
});
content.addEventListener('dragstart',e=>{dragId=e.target.closest('[data-drag]')?.dataset.drag||null;if(dragId)e.dataTransfer.setData('text/plain',dragId);});
content.addEventListener('dragover',e=>{if(dragId&&e.target.closest('[data-day]'))e.preventDefault();});
content.addEventListener('drop',e=>{const d=e.target.closest('[data-day]');if(!d||!dragId)return;e.preventDefault();const id=dragId;dragId=null;setLock(id,travelDays[Number(d.dataset.day)],state.locks[id]?.time,true);});
content.addEventListener('dragend',()=>{dragId=null;});
if(ownerMode)loadState();else render();
