export const types = { sight: '景点', experience: '体验', stay: '住宿', food: '餐厅', event: '临时活动' };
export const entryTypes = {...types, flight: '机票', drive: '自驾', rental: '租还车', transit: '其他交通', break: '休息 / 缓冲'};
export const tripStatuses = {want:'想去', must:'必去', booked:'已预订', done:'已完成'};
export const uid = () => crypto.randomUUID();
export const dayNumber = date => Date.parse(date+'T00:00:00Z') / 86400000;
export const shift = (date, delta) => new Date((dayNumber(date)+delta)*86400000).toISOString().slice(0,10);
export const clock = n => Number.isFinite(n) ? String(Math.floor(n/60)%24).padStart(2,'0')+':'+String(n%60).padStart(2,'0') : '';
export const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dayNumber(date)) && shift(date,0)===date;
export const validCoords = p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90;
export function newProject(name='', regions=[]) {
  return {id:uid(),name,regions,start:'',end:'',archived:false,placeIds:[],statuses:{},schedule:[]};
}
export function migrate(raw, seed, anchors) {
  if(raw?.workspace?.version===1) return raw.workspace;
  const records=raw?.records||{}, locks=raw?.locks||{};
  const project={...newProject('伊比利亚半岛',['ES','PT']),id:'iberia',start:'2027-01-27',end:'2027-02-10'};
  const library=seed.map(p=>{
    const r=records[p.id]||{};
    const type=p.kind==='event'?'event':p.cat==='stay'?'stay':['city','nature'].includes(p.cat)?'sight':'experience';
    if(r.status)project.statuses[p.id]=r.status;
    project.placeIds.push(p.id);
    return {...p,type,saved:!!r.status,coords:validCoords(r.coords)?r.coords:p.coords,approx:!validCoords(r.coords)&&p.approx,
      note:r.post||'', tags:[p.cat], timeZone:p.country==='葡萄牙'?'Europe/Lisbon':'Europe/Madrid'};
  });
  const plan=raw?.trip?.plans?.find(p=>p.end===raw.end)||raw?.trip?.plans?.[0];
  const known=Object.fromEntries([...library,...Object.values(anchors),...(plan?.extras||[])].map(p=>[p.id,p]));
  const planned=new Set();
  const zone=p=>p.timeZone||(p.country==='葡萄牙'||['lisbon','evora'].includes(p.id)?'Europe/Lisbon':'Europe/Madrid');
  const timed=(date,n)=>Number.isFinite(n)?{date:shift(date,Math.floor(n/1440)),time:clock((n%1440+1440)%1440)}:{date,time:''};
  for(const day of plan?.days||[]){
    const activities=day.activities||[];
    const legs=day.legs||[];
    let minute=540, nextLeg=0;
    function addLeg(leg){
      const from=known[leg.from],to=known[leg.to];
      if(!from||!to)return;
      const tz=zone(from),endTz=zone(to);
      const offset=(endTz==='Europe/Lisbon'?-60:0)-(tz==='Europe/Lisbon'?-60:0);
      const departure=timed(day.date,minute);
      minute+=Number(leg.mins||0)+offset;
      const arrival=timed(day.date,minute);
      project.schedule.push({id:uid(),title:from.name+' → '+to.name,type:/道路|自驾/.test(leg.mode)?'drive':'transit',
        date:departure.date,start:departure.time,end:arrival.time,endDate:arrival.date,tz,endTz,fixed:false,notes:leg.mode||'',
        route:{coords:leg.road||leg.coords,km:leg.km,minutes:leg.mins,estimated:!leg.road,provider:raw.trip.provider}});
    }
    for(const activity of activities){
      const p=known[activity.id];
      if(!p)continue;
      if(legs[nextLeg]?.to===p.id)addLeg(legs[nextLeg++]);
      planned.add(p.id);
      const start=timed(day.date,activity.start);
      const end=timed(day.date,activity.end??(activity.start+(p.minutes||60)));
      project.schedule.push({id:uid(),placeId:p.type?p.id:'',title:p.name,type:p.type||'break',date:start.date,
        start:start.time,end:end.time,endDate:end.date,tz:zone(p),fixed:!!activity.locked,notes:''});
      if(Number.isFinite(activity.start))minute=activity.start+(p.minutes||60)+25;
    }
    while(nextLeg<legs.length)addLeg(legs[nextLeg++]);
  }
  for(const [id,lock] of Object.entries(locks)){
    const p=known[id];
    if(!p||planned.has(id)||!validDate(lock.date))continue;
    project.schedule.push({id:uid(),placeId:id,title:p.name,type:p.type,date:lock.date,start:lock.time||'',end:'',tz:p.timeZone||'',fixed:true,notes:'从旧版锁定时段导入'});
  }
  return {version:1,library,projects:[project]};
}
export function updateDates(project,start,end,move) {
  if ((start&&!validDate(start)) || (end&&!validDate(end)) || (start&&end&&end<start)) throw Error('请选择有效日期，结束日期应在出发日期之后');
  const delta=start&&project.start?dayNumber(start)-dayNumber(project.start):0;
  if(move&&delta)for(const item of project.schedule){
    if(!item.fixed&&validDate(item.date)){
      item.date=shift(item.date,delta);
      if(validDate(item.endDate))item.endDate=shift(item.endDate,delta);
    }
  }
  project.start=start;
  project.end=end;
}
const formatters=new Map();
function instant(date,time,tz) {
  if(!validDate(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
  const target=Date.parse(date+'T'+time+'Z');
  if(!tz)return target;
  try{
    if(!formatters.has(tz))formatters.set(tz,new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
    const formatter=formatters.get(tz);
    let candidate=target;
    for(let i=0;i<3;i++){
      const p=Object.fromEntries(formatter.formatToParts(candidate).map(x=>[x.type,x.value]));
      const local=Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+'Z');
      if(local===target)return candidate;
      candidate+=target-local;
    }
  }catch{}
  return null;
}
export function checkSchedule(project) {
  const issues=[], intervals=[];
  for(const item of project.schedule){
    const date=item.date,endDate=item.endDate||date;
    if(date&&((project.start&&date<project.start)||(project.end&&endDate>project.end)))issues.push(item.title+'：超出项目日期');
    if(!date||!item.start||!item.end)continue;
    const begin=instant(date,item.start,item.tz), end=instant(endDate,item.end,item.endTz||item.tz);
    if(begin===null||end===null||end<=begin){issues.push(item.title+'：请复核日期、时区和起止时间');continue;}
    intervals.push({item,begin,end});
  }
  intervals.sort((a,b)=>a.begin-b.begin);
  let previous=null;
  for(const next of intervals){
    if(previous&&next.begin<previous.end&&(next.item.tz&&previous.item.tz||next.item.date===previous.item.date))
      issues.push(previous.item.title+' 与 '+next.item.title+' 时间重叠');
    if(!previous||next.end>previous.end)previous=next;
  }
  return issues;
}
