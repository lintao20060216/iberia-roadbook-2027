import {types,entryTypes,tripStatuses,uid,validDate,validCoords,migrate,newProject,updateDates,checkSchedule,shift} from './workspace-model.mjs';
import {regions,regionName,regionPoints,metro} from './workspace-regions.mjs';

const $=selector=>document.querySelector(selector);
const panel=$('#panelContent'), print=$('#printArea');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}};
const link=(label,url)=>safeLink(url)?'<a target="_blank" rel="noopener noreferrer" href="'+esc(safeLink(url))+'">'+esc(label)+' ↗</a>':'';
const buttons=(action,label,value='',classes='secondary')=>'<button type="button" class="'+classes+'" data-action="'+action+'" data-value="'+esc(value)+'">'+label+'</button>';
const filterTypes={sight:'#667842',experience:'#a7543a',food:'#a26c32',stay:'#6d5683',event:'#386e81',metro:'#247374'};
for(const [id,color] of Object.entries(filterTypes))categories['work-'+id]=[types[id]||'地铁',color,'●'];
const visible=new Set(Object.keys(types));
const map=mountMap(id=>{
  if(id.startsWith('metro:')){transit=true;screen='map';render();$('#metro-'+id.slice(6))?.scrollIntoView({block:'nearest'});return;}
  focus(id);
},notice);
let raw, data, projectId='', screen='map', selected='', query='', nation='', transit=false, routeVisible=true;
let etag='', saveQueue=Promise.resolve(), saveLabel='正在读取私人存档', revision=0, draft=null, undo=null, pendingPick=null;

function notice(message){
  const el=$('#toast');
  el.textContent=message;
  el.classList.add('show');
  clearTimeout(notice.timer);
  notice.timer=setTimeout(()=>el.classList.remove('show'),3500);
}
const project=()=>data.projects.find(p=>p.id===projectId);
const place=id=>data.library.find(p=>p.id===id);
const projectPlaces=p=>p.placeIds.map(place).filter(Boolean);
const dates=p=>[p.start,p.end].filter(Boolean).join(' — ')||'日期待定';
function setStatus(message){
  saveLabel=message;
  if($('#saveStatus'))$('#saveStatus').textContent=message;
}
function save(){
  const snapshot=JSON.stringify({...raw,workspace:data});
  const current=++revision;
  setStatus('正在保存…');
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    if(current!==revision)return;
    try{
      const r=await fetch('/account/api/state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:snapshot,keepalive:snapshot.length<55000});
      if(r.status===412)throw Error('另一设备已更新存档。请先下载备份，再刷新网页合并。');
      if(!r.ok)throw Error('云端保存失败，请重试或下载备份。');
      etag=r.headers.get('ETag')||'';
      if(current===revision)setStatus('已保存到私人存档');
    }catch(error){if(current===revision)setStatus(error.message);}
  });
}
async function load(){
  try{
    const r=await fetch('/account/api/state',{cache:'no-store'});
    if(!r.ok)throw Error();
    etag=r.headers.get('ETag')||'';
    raw=(await r.json()).state||{};
    data=migrate(raw,places,anchors);
    setStatus('私人存档已连接');
    render();
    map.world(true);
  }catch{
    panel.innerHTML='<h2>无法读取私人存档</h2><p>请重新登录或刷新页面。</p><a href="/account/">重试</a>';
  }
}
function scope(){
  const p=project();
  return p?projectPlaces(p):data.library.filter(p=>p.saved);
}
function matches(){
  const q=query.trim().toLowerCase();
  return scope().filter(p=>visible.has(p.type)&&(!nation||p.country===nation)&&(!q||[p.name,p.city,p.country,p.region,p.desc,p.note,...(p.tags||[])].some(s=>String(s||'').toLowerCase().includes(q))));
}
function syncMap(){
  const points=matches().filter(p=>validCoords(p.coords)).map(p=>({...p,cat:'work-'+p.type}));
  const chosen=place(selected);
  if(chosen&&validCoords(chosen.coords)&&!points.some(p=>p.id===chosen.id))points.push({...chosen,cat:'work-'+chosen.type});
  if(transit)metro.forEach(([name,coords],i)=>points.push({id:'metro:'+i,name,coords,cat:'work-metro'}));
  const lines=(routeVisible?project()?.schedule||[]:[]).filter(i=>Array.isArray(i.route?.coords)&&i.route.coords.length>1).map(i=>({...i.route,color:'#9c4e35'}));
  map.set(points,lines,selected);
}
function fitProject(){
  const p=project();
  if(!p){map.world(true);return;}
  const points=[...regionPoints(p.regions),...(p.bounds||[]),...projectPlaces(p).map(p=>p.coords).filter(validCoords)];
  map.showProject(points);
}
function focus(id){
  const p=place(id);
  if(!p)return;
  selected=id;
  screen='map';
  render();
  if(validCoords(p.coords))map.focus(p);
  panel.querySelector('[data-detail]')?.scrollIntoView({block:'nearest'});
}
function render(){
  const p=project();
  $('.maptitle h1').textContent=p?.name||'我的旅行地球';
  $('.maptitle p').textContent=p?p.regions.map(regionName).join(' · ')||dates(p):'从收藏出发，规划下一段旅程';
  $('.maptitle .overline').textContent=p?'旅行项目 / TRIP':'全球收藏 / MY WORLD';
  $('.trip b').textContent=p?.name||'私人旅行空间';
  $('.trip small').textContent=p?dates(p):'邮箱已登录';
  document.querySelectorAll('[data-work-tab]').forEach(b=>b.classList.toggle('active',b.dataset.workTab===screen));
  panel.innerHTML='<div class="work-head"><div class="eyebrow">MY TRAVEL WORKSPACE</div><label class="work-project">旅行项目<select id="projectPicker"><option value="">全球收藏</option>'+data.projects.filter(p=>!p.archived||p.id===projectId).map(p=>'<option value="'+esc(p.id)+'" '+(p.id===projectId?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><div class="work-actions">'+buttons('project-new','＋ 新建项目')+buttons('project-manage','管理')+(p?buttons('project-edit','编辑范围与日期'):'')+'</div><div class="stamp"><span id="saveStatus">'+esc(saveLabel)+'</span> · '+buttons('retry','重新保存')+' '+buttons('backup','下载备份')+'</div></div>'+
    (screen==='plan'?planView(p):screen==='ai'?aiView(p):mapView(p));
  syncMap();
}
function card(p){
  return '<div class="work-row '+(p.id===selected?'is-selected':'')+'">'+buttons('focus',esc(p.name),p.id,'work-title')+
    '<small>'+esc([p.region,p.city,types[p.type]].filter(Boolean).join(' · '))+'</small></div>';
}
function mapView(p){
  const groups=new Map();
  for(const item of matches()){
    const key=item.country||'未分类国家';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  const countries=[...new Set(scope().map(p=>p.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));
  return '<div class="work-actions">'+buttons('place-new','＋ 添加地点','','primary')+(p?buttons('attach','从收藏加入'):'')+'</div>'+
    '<div class="work-search"><input id="workSearch" placeholder="搜索地点、城市或标签" value="'+esc(query)+'"><select id="nation"><option value="">全部国家</option>'+countries.map(c=>'<option '+(nation===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select></div>'+
    '<div class="work-filters">'+Object.entries(types).map(([k,v])=>'<label><input type="checkbox" data-filter="'+k+'" '+(visible.has(k)?'checked':'')+'> '+v+'</label>').join('')+
    '<label><input type="checkbox" id="workRoutes" '+(routeVisible?'checked':'')+'> 自驾线路</label><label><input type="checkbox" id="workTransit" '+(transit?'checked':'')+'> 地铁图层</label></div>'+
    (transit?'<div class="work-box"><b>官方地铁线路图</b>'+metro.map(([name,,url],i)=>'<div id="metro-'+i+'">'+link(name,url)+'</div>').join('')+'<small>底图在城市缩放级别显示有数据的地铁线路。</small></div>':'')+
    detailView(place(selected),p)+[...groups].sort(([a],[b])=>a.localeCompare(b,'zh')).map(([name,list])=>'<div class="section"><h3>'+esc(name)+' · '+list.length+'</h3>'+list.map(card).join('')+'</div>').join('')+
    (groups.size?'':'<p class="intro">这里会显示符合筛选条件的地点。</p>');
}
function detailView(item,p){
  if(!item)return '';
  return '<div class="work-box" data-detail><div class="work-actions">'+buttons('unfocus','关闭')+buttons('place-edit','编辑',item.id)+buttons('toggle-saved',item.saved?'取消收藏':'收藏到账号',item.id)+'</div>'+
    '<h2>'+esc(item.name)+'</h2><p>'+esc([item.country,item.region,item.city,item.address].filter(Boolean).join(' · '))+'</p>'+
    [item.desc,item.note,item.hours,item.booking,item.cost,(item.tags||[]).join(' · ')].filter(Boolean).map(s=>'<p>'+esc(s)+'</p>').join('')+
    '<p>'+link('来源',item.website)+' '+link('照片',item.photo)+'</p>'+
    (p?'<div class="work-actions">'+buttons('schedule-add','加入行程',item.id,'primary')+buttons('detach','移出本项目',item.id)+'</div>'+
      '<label>项目状态 <select id="placeStatus"><option value="">待选择</option>'+Object.entries(tripStatuses).map(([k,v])=>'<option value="'+k+'" '+(p.statuses[item.id]===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label>':'')+'</div>';
}
function entrySummary(i){
  const p=place(i.placeId);
  return '<b>'+esc(i.title)+'</b><small>'+esc([entryTypes[i.type],i.fixed?'已确认':'',i.address||p?.address,i.reference,i.cost].filter(Boolean).join(' · '))+'</small>'+
    (i.route?'<small>'+esc((i.route.estimated?'估算 · ':'道路路线 · ')+i.route.km+' km · '+i.route.minutes+' 分钟 · '+i.route.provider)+'</small>':'')+
    (i.notes?'<small>'+esc(i.notes)+'</small>':'');
}
const sorted=p=>[...p.schedule].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.start||'99').localeCompare(b.start||'99'));
function scheduleGroups(p){
  const groups=new Map();
  if(p.start&&p.end)for(let i=0;i<366;i++){
    const day=shift(p.start,i);
    if(day>p.end)break;
    groups.set(day,[]);
  }
  for(const item of sorted(p)){
    if(!groups.has(item.date))groups.set(item.date,[]);
    groups.get(item.date).push(item);
  }
  return [...groups].sort(([a],[b])=>(a||'9999').localeCompare(b||'9999'));
}
function timeLabel(i){
  const end=i.end?[i.endDate&&i.endDate!==i.date?i.endDate:'',i.end,i.endTz||i.tz].filter(Boolean).join(' '):'';
  return [i.start?[i.start,i.tz].filter(Boolean).join(' '):'',end].filter(Boolean).join(' → ')||'时间待定';
}
function planView(p){
  if(!p)return '<h2>每日行程</h2><p>先选择或创建一个旅行项目。</p>';
  const issues=checkSchedule(p);
  return '<h2>每日行程</h2><p class="intro">'+esc(dates(p))+'</p><div class="work-actions">'+buttons('schedule-add','＋ 新增事项','','primary')+buttons('drive','计算自驾路段')+buttons('day-draft','生成一天自驾草案')+buttons('print','导出 PDF')+'</div>'+
    (issues.length?'<div class="warning">'+issues.map(esc).join('<br>')+'</div>':'')+
    scheduleGroups(p).map(([date,items])=>'<details class="day" '+(items.length?'open':'')+'><summary>'+esc(date||'待定日期')+' · '+items.length+' 项</summary>'+
      items.map(i=>'<div class="work-row"><small>'+esc(timeLabel(i))+'</small>'+entrySummary(i)+'<div class="work-actions">'+buttons('schedule-edit','编辑',i.id)+(i.placeId&&place(i.placeId)?buttons('focus','地图',i.placeId):'')+'</div></div>').join('')+
      buttons('schedule-date','＋ 添加到这一天',date)+'</details>').join('');
}
function aiView(p){
  if(!p)return '<h2>AI 旅行助手</h2><p>先选择旅行项目。</p>';
  return '<h2>AI 旅行助手</h2><p class="intro">结合项目地点与已确认安排生成建议。草案需确认后才会加入行程。</p><form id="aiForm"><label>你的需求<textarea name="prompt" maxlength="2000" required placeholder="例如：把巴塞罗那留两天，避免影响已订酒店"></textarea></label><label><input type="checkbox" name="web" checked> 查询公开网页并附来源</label><button class="primary">生成建议</button></form><p id="aiStatus" role="status"></p>'+
    (draft?.projectId===p.id?'<div class="work-box"><p class="ai-text">'+esc(draft.summary)+'</p>'+draft.sources.map(s=>'<p>'+link(s.title||'查看来源',s.url)+'</p>').join('')+
      draft.items.map(i=>'<div class="work-row"><small>'+esc([i.date,timeLabel(i)].filter(Boolean).join(' · '))+'</small>'+entrySummary(i)+'</div>').join('')+
      (draft.items.length?buttons('ai-apply','确认加入草案','','primary'):'')+'</div>':'')+
    (undo?.projectId===p.id?buttons('ai-undo','撤销上次加入'):'');
}

const dlg=$('#workDialog'), form=dlg.querySelector('form');
const input=(name,label,value='',type='text',attrs='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
const area=(name,label,value='')=>'<label>'+label+'<textarea name="'+name+'">'+esc(value)+'</textarea></label>';
const options=(values,selected)=>Object.entries(values).map(([id,label])=>'<option value="'+esc(id)+'" '+(id===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
const select=(name,label,values,value='',attrs='')=>'<label>'+label+'<select name="'+name+'" '+attrs+'>'+options(values,value)+'</select></label>';
const check=(name,label,on)=>'<label><input type="checkbox" name="'+name+'" '+(on?'checked':'')+'> '+label+'</label>';
const pair=(...items)=>'<div class="work-pair">'+items.join('')+'</div>';
let submitDialog;
function dialog(title,html,submit,label='保存'){
  form.innerHTML='<div class="work-actions"><h2>'+esc(title)+'</h2>'+buttons('close','关闭')+'</div>'+html+'<p id="workError" class="warning" hidden></p>'+
    (submit?'<button class="primary" type="submit">'+label+'</button>':'');
  submitDialog=submit;
  if(!dlg.open)dlg.showModal();
}
const values=()=>Object.fromEntries(new FormData(form));
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const error=$('#workError'),button=form.querySelector('[type=submit]');
  if(!submitDialog||button.disabled)return;
  error.hidden=true;button.disabled=true;
  try{await submitDialog(values());dlg.close();render();}
  catch(e){error.textContent=e.message;error.hidden=false;}
  finally{button.disabled=false;}
});
function projectEditor(existing){
  const p=existing||newProject();
  const known=Object.fromEntries(Object.entries(regions).map(([id,[label]])=>[id,label]));
  const chosen=new Set(p.regions.filter(r=>regions[r]));
  dialog(existing?'编辑项目':'新建旅行项目',input('name','项目名称',p.name,'text','required maxlength="100"')+
    pair(input('start','出发日期',p.start,'date'),input('end','结束日期',p.end,'date'))+
    '<label>搜索国家 / 州省<input id="regionSearch" placeholder="例如：美国、夏威夷或 US-HI"></label><div id="regionChoices" class="work-regions"></div>'+
    input('custom','其他国家或州省（用逗号分隔）',p.regions.filter(r=>!regions[r]).join('，'))+
    input('bounds','自定义地图范围（西经度,南纬度,东经度,北纬度）',p.bounds?.flat().join(',')||'')+
    (existing?check('move','随出发日期平移未确认的行程',false):''),
  v=>{
    const bounds=v.bounds.trim()?v.bounds.split(/[,，]/).map(s=>s.trim()===''?NaN:Number(s)):[];
    if(bounds.length&&!(bounds.length===4&&validCoords(bounds.slice(0,2))&&validCoords(bounds.slice(2))&&bounds[1]<=bounds[3]))throw Error('地图范围需要四个有效坐标');
    if(!v.name.trim())throw Error('请输入项目名称');
    updateDates(p,v.start,v.end,v.move==='on');
    p.name=v.name.trim();
    p.regions=[...new Set([...chosen,...v.custom.split(/[,，]/).map(s=>s.trim()).filter(Boolean)])];
    p.bounds=bounds.length?[bounds.slice(0,2),bounds.slice(2)]:[];
    if(!existing)data.projects.push(p);
    openProject(p.id);save();
  });
  const search=$('#regionSearch'), list=$('#regionChoices');
  const choices=Object.entries(known).sort((a,b)=>a[1].localeCompare(b[1],'zh'));
  function renderRegions(){
    const q=search.value.trim().toLowerCase();
    const matched=choices.filter(([id,label])=>!chosen.has(id)&&(!q||id.toLowerCase().includes(q)||label.toLowerCase().includes(q)));
    const shown=[...choices.filter(([id])=>chosen.has(id)),...matched.slice(0,35)];
    list.innerHTML=shown.map(([id,label])=>'<label><input type="checkbox" value="'+esc(id)+'" '+(chosen.has(id)?'checked':'')+'> '+esc(label)+' <small>'+esc(id)+'</small></label>').join('');
    if(!shown.length)list.textContent='没有匹配的地区，可在下方手动填写。';
  }
  search.oninput=renderRegions;
  list.onchange=e=>{const {value,checked}=e.target;if(checked)chosen.add(value);else chosen.delete(value);};
  renderRegions();
}
const timeZone=p=>p?.timeZone||'';
function placeEditor(existing,fromMap=null){
  const item=existing||{id:uid(),type:'sight',saved:true};
  const coords=fromMap||item.coords;
  const extra={hours:'开放或营业时间',booking:'预约 / 入住退房信息',cost:'费用 / 预算',website:'来源网址',photo:'图片网址'};
  dialog(existing?'编辑地点':'添加地点',input('name','名称',item.name,'text','required maxlength="160"')+select('type','类型',types,item.type)+
    pair(input('country','国家',item.country,'text','required'),input('region','州 / 省',item.region))+
    pair(input('city','城市',item.city),input('timeZone','时区（如 Europe/Madrid）',item.timeZone))+input('address','地址',item.address)+
    pair(input('lng','经度',coords?.[0],'number','step="any" min="-180" max="180"'),input('lat','纬度',coords?.[1],'number','step="any" min="-90" max="90"'))+
    buttons('pick-point','在地图上点选坐标')+input('minutes','建议停留分钟',item.minutes,'number','min="0" max="1440"')+
    Object.entries(extra).map(([k,label])=>input(k,label,item[k],['website','photo'].includes(k)?'url':'text')).join('')+
    input('tags','自定义标签（用逗号分隔）',item.tags?.join('，'))+area('desc','简介',item.desc)+area('note','个人备注',item.note)+
    (existing?buttons('place-delete','删除地点',item.id):''),
  v=>{
    const coords=v.lng!==''&&v.lat!==''?[Number(v.lng),Number(v.lat)]:null;
    if((v.lng!==''||v.lat!=='')&&!validCoords(coords))throw Error('请填写一对有效坐标');
    if(!v.name.trim()||!v.country.trim())throw Error('请输入地点名称和国家');
    if(v.timeZone)try{new Intl.DateTimeFormat('en',{timeZone:v.timeZone});}catch{throw Error('请输入有效的 IANA 时区');}
    const {lng,lat,...fields}=v;
    Object.assign(item,fields,{name:v.name.trim(),country:v.country.trim(),coords,approx:validCoords(coords)&&String(coords)===String(item.coords)&&!!item.approx,minutes:Number(v.minutes)||0,tags:v.tags.split(/[,，]/).map(x=>x.trim()).filter(Boolean)});
    if(!existing){
      data.library.push(item);
      if(project())project().placeIds.push(item.id);
    }
    selected=item.id;
    if(coords)map.focus(item);
    save();
  });
}
function scheduleEditor(existing,placeId='',date=''){
  const p=project(), item=place(placeId);
  const entry=existing||{id:uid(),placeId,title:item?.name||'',type:item?.type||'sight',date:date||p.start,start:'',end:'',tz:timeZone(item),address:item?.address||''};
  const source=Object.fromEntries([['','不关联'],...[...new Set([...p.placeIds,entry.placeId])].map(place).filter(Boolean).map(p=>[p.id,p.name])]);
  dialog(existing?'编辑行程事项':'新增行程事项',input('title','事项名称',entry.title,'text','required maxlength="160"')+
    pair(select('type','类型',entryTypes,entry.type),select('placeId','关联地点',source,entry.placeId))+
    pair(input('date','开始日期',entry.date,'date'),input('start','开始时间',entry.start,'time'))+
    pair(input('endDate','结束日期（跨日填写）',entry.endDate,'date'),input('end','结束时间',entry.end,'time'))+
    pair(input('tz','出发时区',entry.tz),input('endTz','到达时区（不同才填）',entry.endTz))+
    input('address','地址 / 起终点',entry.address)+input('reference','航班号 / 预订信息',entry.reference)+input('cost','费用',entry.cost)+
    area('notes','备注',entry.notes)+check('fixed','已确认，项目改期时保持原日期',entry.fixed)+
    (existing?buttons('schedule-delete','移除事项',entry.id):''),
  v=>{
    if(!v.title.trim())throw Error('请输入事项名称');
    if(v.endDate&&(!v.date||v.endDate<v.date))throw Error('结束日期应在开始日期当天或之后');
    Object.assign(entry,v,{fixed:v.fixed==='on'});
    if(!existing)p.schedule.push(entry);
    save();
  });
}
function driveEditor(){
  const p=project();
  const locations=Object.fromEntries(projectPlaces(p).filter(p=>validCoords(p.coords)).map(p=>[p.id,p.name]));
  if(Object.keys(locations).length<2){notice('先为项目添加至少两个有坐标的地点');return;}
  dialog('计算自驾路段',select('from','出发地点',locations)+select('to','到达地点',locations)+
    '<div id="waypoints"></div>'+buttons('add-via','＋ 添加途经点')+
    pair(input('date','日期',p.start,'date'),input('start','当地出发时间','','time'))+
    '<p class="tiny">只为相连的陆路路段计算。跨海航班可以另加为机票事项。此估算不含实时交通。</p>',async v=>{
    const ids=[v.from,...new FormData(form).getAll('via'),v.to].filter(Boolean);
    if(new Set(ids).size!==ids.length)throw Error('起点、途经点与终点需要不同');
    const stops=ids.map(place);
    const route=await api('drive',{coords:stops.map(p=>p.coords)});
    const from=stops[0],to=stops.at(-1);
    const tz=timeZone(from),endTz=timeZone(to);
    let end='',endDate='';
    if(validDate(v.date)&&v.start&&(!endTz||tz===endTz)){
      const time=new Date(Date.parse(v.date+'T'+v.start+'Z')+route.minutes*60000).toISOString();
      end=time.slice(11,16);endDate=time.slice(0,10);
    }
    p.schedule.push({id:uid(),title:stops.map(p=>p.name).join(' → '),type:'drive',date:v.date,start:v.start,end,endDate,tz,endTz,
      fixed:false,route,notes:endTz&&tz!==endTz?'跨时区路段，请核对并填写到达当地时间。':''});
    save();
  },'计算并加入行程');
  $('#waypoints').dataset.locations=JSON.stringify(locations);
}
function dayDraftEditor(){
  const p=project();
  const locations=Object.fromEntries(projectPlaces(p).filter(p=>validCoords(p.coords)).map(p=>[p.id,p.name]));
  if(Object.keys(locations).length<2){notice('先为项目添加至少两个有坐标的地点');return;}
  dialog('生成一天自驾草案',pair(input('date','日期',p.start,'date','required'),input('start','从首站开始的时间','09:00','time','required'))+
    select('from','首站',locations)+
    '<div id="waypoints"></div>'+buttons('add-via','＋ 添加途经景点')+
    select('to','末站',locations)+input('buffer','每站之间预留的停车与步行时间（分钟）','20','number','min="0" max="180" required')+
    '<p class="tiny">按选择顺序安排停留和道路车程。建议时长空白的地点会暂用 60 分钟，生成后可逐项修改。</p>',
  async v=>{
    const ids=[v.from,...new FormData(form).getAll('via'),v.to].filter(Boolean);
    if(new Set(ids).size!==ids.length)throw Error('请给每一站选择不同地点');
    const stops=ids.map(place), zones=[...new Set(stops.map(timeZone).filter(Boolean))];
    if(zones.length>1)throw Error('跨时区行程请分开生成，再添加两地之间的交通');
    const route=await api('drive',{coords:stops.map(s=>s.coords)});
    if(!Array.isArray(route.legs)||route.legs.length!==stops.length-1||route.legs.some(l=>!Number.isFinite(l.minutes)))throw Error('路线服务未返回每段车程，请改为逐段添加');
    const tz=zones[0]||'';
    let now=Date.parse(v.date+'T'+v.start+'Z');
    const added=[];
    function add(title,type,minutes,extra={}){
      const start=new Date(now).toISOString();
      now+=minutes*60000;
      const end=new Date(now).toISOString();
      added.push({id:uid(),title,type,date:start.slice(0,10),start:start.slice(11,16),endDate:end.slice(0,10),end:end.slice(11,16),tz,fixed:false,...extra});
    }
    stops.forEach((stop,i)=>{
      if(i){
        const leg=route.legs[i-1];
        add(stops[i-1].name+' → '+stop.name,'drive',leg.minutes,{route:{...leg,provider:route.provider,estimated:false,...(i===1?{coords:route.coords}:{})}});
        if(Number(v.buffer))add('停车、步行与缓冲','break',Number(v.buffer));
      }
      add(stop.name,stop.type,stop.minutes||60,{placeId:stop.id,address:stop.address,notes:stop.minutes?'':'待核对建议停留时间'});
    });
    const warnings=checkSchedule({...p,schedule:[...p.schedule,...added]});
    if(warnings.length&&!confirm('草案有时间冲突或超出日期，仍加入以便编辑？\n'+warnings.slice(0,5).join('\n')))return;
    p.schedule.push(...added);save();
  },'生成并加入当天行程');
  $('#waypoints').dataset.locations=JSON.stringify(locations);
}
async function api(path,body){
  const r=await fetch('/account/api/workspace/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json().catch(()=>({error:'服务暂不可用，请重试'}));
  if(!r.ok)throw Error(result.error||'服务暂不可用，请重试');
  return result;
}
function openProject(id){
  projectId=id;selected='';query='';nation='';screen='map';render();fitProject();
}
function exportPlan(p){
  const sections=scheduleGroups(p);
  print.innerHTML='<article><h1>'+esc(p.name)+'</h1><p>'+esc(dates(p)+' · '+p.regions.map(regionName).join(' / '))+'</p>'+
    sections.map(([date,items])=>'<section><h2>'+esc(date||'时间待定')+'</h2>'+(items.length?items.map(i=>'<div class="print-row"><strong>'+esc(timeLabel(i))+'</strong> '+entrySummary(i)+'</div>').join(''):'<p>自由安排</p>')+'</section>').join('')+
    '<section><h2>项目地点与预订备注</h2>'+projectPlaces(p).map(i=>'<div class="print-row"><b>'+esc(i.name)+'</b><small>'+esc([types[i.type],i.country,i.city,i.address,i.hours,i.booking,i.cost,i.note].filter(Boolean).join(' · '))+'</small>'+link('来源',i.website)+'</div>').join('')+'</section></article>';
  window.print();
}
const actions={
  'project-new':()=>projectEditor(),
  'project-edit':()=>projectEditor(project()),
  'project-manage':()=>dialog('管理旅行项目',data.projects.map(p=>'<div class="work-row"><b>'+esc(p.name)+'</b><div class="work-actions">'+buttons('open-project','打开',p.id)+buttons('archive',p.archived?'取消归档':'归档',p.id)+buttons('project-delete','删除',p.id)+'</div></div>').join('')),
  'open-project':id=>{dlg.close();openProject(id);},
  archive:id=>{const p=data.projects.find(p=>p.id===id);p.archived=!p.archived;dlg.close();openProject('');save();},
  'project-delete':id=>{if(!confirm('删除此项目和其中的行程？账号收藏仍会保留。'))return;data.projects=data.projects.filter(p=>p.id!==id);dlg.close();openProject('');save();},
  'place-new':()=>placeEditor(),
  'place-edit':id=>placeEditor(place(id)),
  'place-delete':id=>{
    if(!confirm('删除这个地点并从所有项目移除？已排好的行程仍保留。'))return;
    data.library=data.library.filter(p=>p.id!==id);
    data.projects.forEach(p=>{p.placeIds=p.placeIds.filter(x=>x!==id);delete p.statuses[id];});
    dlg.close();selected='';save();render();
  },
  'pick-point':()=>{
    pendingPick={form:values()};
    dlg.close();map.pick(coords=>{
      const previous=pendingPick.form;pendingPick=null;
      dlg.showModal();
      for(const [name,value] of Object.entries(previous))if(form.elements[name])form.elements[name].value=value;
      form.elements.lng.value=coords[0].toFixed(6);form.elements.lat.value=coords[1].toFixed(6);
    });
    notice('请在地图上点选位置');
  },
  attach:()=>{
    const p=project();
    const candidates=data.library.filter(i=>i.saved&&!p.placeIds.includes(i.id));
    dialog('从账号收藏加入',candidates.length?candidates.map(i=>'<label><input type="checkbox" name="items" value="'+esc(i.id)+'"> '+esc(i.name)+'</label>').join(''):'<p>没有可加入的收藏。</p>',
      candidates.length?()=>{p.placeIds.push(...new FormData(form).getAll('items'));save();fitProject();}:null);
  },
  detach:id=>{const p=project();p.placeIds=p.placeIds.filter(x=>x!==id);delete p.statuses[id];selected='';save();render();},
  'toggle-saved':id=>{place(id).saved=!place(id).saved;save();render();},
  focus,unfocus:()=>{selected='';render();},
  'schedule-add':id=>{screen='plan';render();scheduleEditor(null,id);},
  'schedule-date':date=>scheduleEditor(null,'',date),
  'schedule-edit':id=>scheduleEditor(project().schedule.find(x=>x.id===id)),
  'schedule-delete':id=>{if(!confirm('移除这个行程事项？'))return;project().schedule=project().schedule.filter(x=>x.id!==id);dlg.close();save();render();},
  drive:driveEditor,
  'day-draft':dayDraftEditor,
  'add-via':()=>{
    const rows=$('#waypoints');
    if(rows.children.length>=10)return;
    rows.insertAdjacentHTML('beforeend',select('via','途经点 '+(rows.children.length+1),{'':'跳过',...JSON.parse(rows.dataset.locations)}));
  },
  print:()=>exportPlan(project()),
  close:()=>dlg.close(),
  retry:save,
  backup:()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({...raw,workspace:data},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='travel-workspace-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  'ai-apply':()=>{
    const p=project();
    if(draft?.projectId!==p.id)return;
    const additions=draft.items.map(i=>({...i,id:uid(),fixed:false}));
    const warnings=checkSchedule({...p,schedule:[...p.schedule,...additions]});
    if(warnings.length&&!confirm('加入后请检查：\n'+warnings.slice(0,5).join('\n')))return;
    undo={projectId:p.id,ids:additions.map(i=>i.id)};
    p.schedule.push(...additions);draft=null;save();screen='plan';render();
  },
  'ai-undo':()=>{const p=project();p.schedule=p.schedule.filter(i=>!undo.ids.includes(i.id));undo=null;save();render();}
};
document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b||!data)return;
  if(b.dataset.workTab){screen=b.dataset.workTab;render();}
  if(b.dataset.action)actions[b.dataset.action]?.(b.dataset.value);
});
document.addEventListener('change',e=>{
  if(!data)return;
  const t=e.target;
  if(t.id==='projectPicker')openProject(t.value);
  if(t.id==='nation'){nation=t.value;render();}
  if(t.dataset.filter){if(t.checked)visible.add(t.dataset.filter);else{visible.delete(t.dataset.filter);if(place(selected)?.type===t.dataset.filter)selected='';}render();}
  if(t.id==='workTransit'){transit=t.checked;map.transit(transit);render();}
  if(t.id==='workRoutes'){routeVisible=t.checked;syncMap();}
  if(t.id==='placeStatus'&&project()&&selected){project().statuses[selected]=t.value;save();}
});
panel.addEventListener('input',e=>{
  if(e.target.id!=='workSearch')return;
  query=e.target.value;
  const cursor=e.target.selectionStart;
  render();
  $('#workSearch').focus();$('#workSearch').setSelectionRange(cursor,cursor);
});
panel.addEventListener('submit',async e=>{
  if(e.target.id!=='aiForm')return;
  e.preventDefault();
  const p=project(), v=new FormData(e.target), status=$('#aiStatus'), b=e.target.querySelector('button');
  b.disabled=true;status.textContent='正在生成草案…';
  try{
    const schedule=p.schedule.slice(0,80).map(({title,type,date,start,end,endDate,tz,endTz,fixed})=>({title,type,date,start,end,endDate,tz,endTz,fixed}));
    const stops=projectPlaces(p).slice(0,100).map(({name,country,city,type,minutes})=>({name,country,city,type,minutes}));
    const result=await api('ai',{prompt:v.get('prompt'),web:v.has('web'),project:{name:p.name,start:p.start,end:p.end,regions:p.regions.map(regionName),schedule,stops}});
    if(projectId!==p.id||screen!=='ai')return;
    draft={...result,projectId:p.id};render();
  }catch(e){status.textContent=e.message;}
  finally{b.disabled=false;}
});
$('#sheetGrip').onclick=()=>$('#panel').classList.toggle('expanded');
$('#resetMap').onclick=()=>fitProject();
$('#worldMap').onclick=()=>openProject('');
load();
